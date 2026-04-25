use open_xiaoai::services::audio::config::AudioConfig;
use open_xiaoai::services::monitor::kws::KwsMonitor;
use serde_json::json;
use std::time::Duration;
use tokio::time::sleep;
use tokio_tungstenite::connect_async;

use open_xiaoai::base::AppError;
use open_xiaoai::base::VERSION;
use open_xiaoai::services::audio::play::AudioPlayer;
use open_xiaoai::services::audio::record::AudioRecorder;
use open_xiaoai::services::connect::data::{Event, Request, Response, Stream};
use open_xiaoai::services::connect::handler::MessageHandler;
use open_xiaoai::services::connect::message::{MessageManager, WsStream};
use open_xiaoai::services::connect::rpc::RPC;
use open_xiaoai::services::monitor::instruction::InstructionMonitor;
use open_xiaoai::services::monitor::playing::PlayingMonitor;

struct AppClient {
    kws_monitor: KwsMonitor,
    instruction_monitor: InstructionMonitor,
    playing_monitor: PlayingMonitor,
}

impl AppClient {
    pub fn new() -> Self {
        Self {
            kws_monitor: KwsMonitor::new(),
            instruction_monitor: InstructionMonitor::new(),
            playing_monitor: PlayingMonitor::new(),
        }
    }

    pub async fn connect(&self, url: &str) -> Result<WsStream, AppError> {
        let (ws_stream, _) = connect_async(url).await?;
        Ok(WsStream::Client(ws_stream))
    }

    pub async fn run(&mut self) {
        let url = std::env::args().nth(1).expect("❌ 请输入服务器地址");
        println!("✅ 已启动");
        loop {
            let Ok(ws_stream) = self.connect(&url).await else {
                sleep(Duration::from_secs(1)).await;
                continue;
            };
            println!("✅ 已连接: {:?}", url);
            self.init(ws_stream).await;
            if let Err(e) = MessageManager::instance().process_messages().await {
                eprintln!("❌ 消息处理异常: {}", e);
            }
            self.dispose().await;
            eprintln!("❌ 已断开连接");
        }
    }

    async fn init(&mut self, ws_stream: WsStream) {
        MessageManager::instance().init(ws_stream).await;
        MessageHandler::<Event>::instance()
            .set_handler(on_event)
            .await;
        MessageHandler::<Stream>::instance()
            .set_handler(on_stream)
            .await;

        let rpc = RPC::instance();
        rpc.add_command("get_version", get_version).await;
        rpc.add_command("run_shell", run_shell).await;
        rpc.add_command("start_play", start_play).await;
        rpc.add_command("stop_play", stop_play).await;
        rpc.add_command("start_recording", start_recording).await;
        rpc.add_command("stop_recording", stop_recording).await;

        self.instruction_monitor
            .start(|event| async move {
                // 转发事件
                let _ = MessageManager::instance()
                    .send_event("instruction", Some(json!(event)))
                    .await;

                // 处理本地音乐推荐逻辑
                if let open_xiaoai::services::monitor::file::FileMonitorEvent::NewLine(line) = event {
                    if let Ok(log_message) = serde_json::from_str::<open_xiaoai::services::monitor::instruction::LogMessage>(&line) {
                        if let open_xiaoai::services::monitor::instruction::Payload::RecognizeResultPayload { results, is_final, .. } = log_message.payload {
                            if is_final && !results.is_empty() {
                                let text = &results[0].text;
                                // 拦截播放指令
                                let keywords = ["播放", "放", "来首", "来一首", "想听", "我要听", "听"];
                                let stop_keywords = ["停止", "暂停", "别唱了", "闭嘴", "别放了"];
                                
                                if stop_keywords.iter().any(|&k| text.contains(k)) {
                                    println!("🛑 收到停止指令: {}", text);
                                    tokio::spawn(async move {
                                        use open_xiaoai::utils::shell::run_shell;
                                        use open_xiaoai::services::audio::playlist::PlaylistManager;
                                        
                                        // 停止播放列表
                                        let playlist = PlaylistManager::instance();
                                        let mut playlist_guard = playlist.lock().await;
                                        playlist_guard.is_playing = false;
                                        playlist_guard.clear();
                                        
                                        // 停止底层播放
                                        let _ = run_shell("mphelper pause").await;
                                        let _ = run_shell("/usr/sbin/tts_play.sh '好的，已停止播放'").await;
                                    });
                                } else if (keywords.iter().any(|&k| text.starts_with(k)) || text.contains("推荐歌") || text.contains("来首歌")) && !stop_keywords.iter().any(|&k| text.contains(k)) {
                                    println!("🎵 收到指令: {}", text);
                                    let text_clone = text.clone();
                                    
                                    tokio::spawn(async move {
                                        use open_xiaoai::utils::shell::run_shell;
                                        use tokio::time::{sleep, Duration};
                                        use open_xiaoai::services::audio::playlist::PlaylistManager;

                                        // 提取关键词
                                        let mut keyword = text_clone.as_str();
                                        for prefix in ["播放", "放", "来首", "来一首", "想听", "我要听", "听"] {
                                            if keyword.starts_with(prefix) {
                                                keyword = keyword.trim_start_matches(prefix).trim();
                                                break;
                                            }
                                        }

                                        // 判断是否为推荐模式
                                        let is_recommend = keyword == "推荐" || keyword.contains("推荐歌") || text_clone.contains("来首歌") || keyword.is_empty();

                                        let prompt = if is_recommend { "好的，为您播放推荐歌曲" } else { "正在为您搜索" };

                                        // 先暂停系统当前播放，防止原声和我们的TTS同时播放
                                        let _ = run_shell("mphelper pause").await;
                                        // 立即播放提示音
                                        let _ = run_shell(&format!("/usr/sbin/tts_play.sh '{}'", prompt)).await;

                                        // 延迟2秒，确保TTS播报完成后再开始播放歌曲
                                        sleep(Duration::from_secs(2)).await;
                                        
                                        let playlist = PlaylistManager::instance();
                                        let mut playlist_guard = playlist.lock().await;
                                        playlist_guard.clear();
                                        
                                        let success = if is_recommend {
                                            playlist_guard.fetch_recommendations().await
                                        } else {
                                            if !keyword.is_empty() {
                                                playlist_guard.fetch_search(keyword).await
                                            } else {
                                                false
                                            }
                                        };

                                        if success {
                                            playlist_guard.play_current().await;
                                        } else {
                                            println!("❌ 未找到歌曲");
                                            let _ = run_shell("/usr/sbin/tts_play.sh '抱歉，未找到相关歌曲'").await;
                                        }
                                    });
                                }
                            }
                        }
                    }
                }

                Ok(())
            })
            .await;

        self.playing_monitor
            .start(|event| async move {
                // 转发事件
                let _ = MessageManager::instance()
                    .send_event("playing", Some(json!(event.clone())))
                    .await;
                
                // 自动播放下一首
                if let open_xiaoai::services::monitor::playing::PlayingMonitorEvent::Idle = event {
                    use open_xiaoai::services::audio::playlist::PlaylistManager;
                    let playlist = PlaylistManager::instance();
                    let mut playlist_guard = playlist.lock().await;
                    if playlist_guard.is_playing {
                        println!("🎵 当前歌曲播放结束，尝试播放下一首");
                        playlist_guard.try_next().await;
                    }
                }
                
                Ok(())
            })
            .await;

        self.kws_monitor
            .start(|event| async move {
                MessageManager::instance()
                    .send_event("kws", Some(json!(event)))
                    .await
            })
            .await;
    }

    async fn dispose(&mut self) {
        MessageManager::instance().dispose().await;
        let _ = AudioPlayer::instance().stop().await;
        let _ = AudioRecorder::instance().stop_recording().await;
        self.instruction_monitor.stop().await;
        self.playing_monitor.stop().await;
        self.kws_monitor.stop().await;
    }
}

async fn get_version(_: Request) -> Result<Response, AppError> {
    let data = json!(VERSION.to_string());
    Ok(Response::from_data(data))
}

async fn start_play(request: Request) -> Result<Response, AppError> {
    let config = request
        .payload
        .and_then(|payload| serde_json::from_value::<AudioConfig>(payload).ok());
    AudioPlayer::instance().start(config).await?;
    Ok(Response::success())
}

async fn stop_play(_: Request) -> Result<Response, AppError> {
    AudioPlayer::instance().stop().await?;
    
    // 停止播放列表
    use open_xiaoai::services::audio::playlist::PlaylistManager;
    let playlist = PlaylistManager::instance();
    let mut playlist_guard = playlist.lock().await;
    playlist_guard.is_playing = false;
    
    // 确保底层播放器也暂停
    let _ = open_xiaoai::utils::shell::run_shell("mphelper pause").await;

    Ok(Response::success())
}

async fn start_recording(request: Request) -> Result<Response, AppError> {
    let config = request
        .payload
        .and_then(|payload| serde_json::from_value::<AudioConfig>(payload).ok());
    AudioRecorder::instance()
        .start_recording(
            |bytes| async {
                MessageManager::instance()
                    .send_stream("record", bytes, None)
                    .await
            },
            config,
        )
        .await?;
    Ok(Response::success())
}

async fn stop_recording(_: Request) -> Result<Response, AppError> {
    AudioRecorder::instance().stop_recording().await?;
    Ok(Response::success())
}

async fn run_shell(request: Request) -> Result<Response, AppError> {
    let script = match request.payload {
        Some(payload) => serde_json::from_value::<String>(payload)?,
        _ => return Err("empty command".into()),
    };
    let res = open_xiaoai::utils::shell::run_shell(script.as_str()).await?;
    Ok(Response::from_data(json!(res)))
}

async fn on_event(event: Event) -> Result<(), AppError> {
    println!("🔥 收到事件: {:?}", event);
    Ok(())
}

async fn on_stream(stream: Stream) -> Result<(), AppError> {
    let Stream { tag, bytes, .. } = stream;
    if tag.as_str() == "play" {
        // 播放接收到的音频流
        let _ = AudioPlayer::instance().play(bytes).await;
    }
    Ok(())
}

#[tokio::main]
async fn main() {
    AppClient::new().run().await;
}

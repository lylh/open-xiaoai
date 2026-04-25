use serde::{Deserialize, Serialize};
use crate::utils::shell::run_shell;
use std::time::Duration;
use tokio::time::sleep;
use std::sync::{Arc, LazyLock};
use tokio::sync::Mutex;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Song {
    pub id: i64,
    pub name: String,
    pub artist: String,
}

pub struct PlaylistManager {
    songs: Vec<Song>,
    current_index: usize,
    pub is_playing: bool,
}

static INSTANCE: LazyLock<Arc<Mutex<PlaylistManager>>> = LazyLock::new(|| {
    Arc::new(Mutex::new(PlaylistManager::new()))
});

impl PlaylistManager {
    pub fn new() -> Self {
        Self {
            songs: Vec::new(),
            current_index: 0,
            is_playing: false,
        }
    }

    pub fn instance() -> Arc<Mutex<PlaylistManager>> {
        INSTANCE.clone()
    }

    pub fn set_songs(&mut self, songs: Vec<Song>) {
        self.songs = songs;
        self.current_index = 0;
        self.is_playing = true;
    }

    pub fn get_current_song(&self) -> Option<&Song> {
        self.songs.get(self.current_index)
    }

    fn next_song(&mut self) -> Option<&Song> {
        if self.current_index + 1 < self.songs.len() {
            self.current_index += 1;
            self.songs.get(self.current_index)
        } else {
            None
        }
    }
    
    pub fn clear(&mut self) {
        self.songs.clear();
        self.current_index = 0;
        self.is_playing = false;
    }

    pub async fn play_current(&self) {
        if let Some(song) = self.get_current_song() {
            play_song(song).await;
        }
    }

    pub async fn try_next(&mut self) {
        if self.is_playing {
             if let Some(song) = self.next_song() {
                 // 需要克隆一下，因为 play_song 是 async 的，而 self 被借用了
                 let song = song.clone(); 
                 play_song(&song).await;
             } else {
                 self.is_playing = false;
                 println!("🎵 播放列表结束");
             }
        }
    }

    pub async fn fetch_recommendations(&mut self) -> bool {
        let cmd = "curl -s \"https://kele.160622.xyz:14000/recommend/songs\"";
        if let Ok(res) = run_shell(cmd).await {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&res.stdout) {
                if let Some(daily_songs) = json.get("data").and_then(|data| data.get("dailySongs")).and_then(|s| s.as_array()) {
                    let songs: Vec<Song> = daily_songs.iter().filter_map(|song| {
                        let id = song.get("id").and_then(|v| v.as_i64())?;
                        let name = song.get("name").and_then(|v| v.as_str())?.to_string();
                        let artist = song.get("ar").or(song.get("artists"))
                            .and_then(|a| a.get(0))
                            .and_then(|a| a.get("name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("未知歌手")
                            .to_string();
                        Some(Song { id, name, artist })
                    }).collect();

                    if !songs.is_empty() {
                        println!("🎵 获取到 {} 首推荐歌曲", songs.len());
                        self.set_songs(songs);
                        return true;
                    }
                }
            }
        }
        false
    }

    pub async fn fetch_search(&mut self, keyword: &str) -> bool {
        // 使用 curl --data-urlencode 处理中文编码
        let cmd = format!("curl -s -G \"https://kele.160622.xyz:14000/search\" --data-urlencode \"keywords={}\"", keyword);
        if let Ok(res) = run_shell(&cmd).await {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&res.stdout) {
                if let Some(song_list) = json.get("result").and_then(|r| r.get("songs")).and_then(|s| s.as_array()) {
                     let songs: Vec<Song> = song_list.iter().take(10).filter_map(|song| { // 取前10首
                        let id = song.get("id").and_then(|v| v.as_i64())?;
                        let name = song.get("name").and_then(|v| v.as_str())?.to_string();
                        let artist = song.get("artists")
                            .and_then(|a| a.get(0))
                            .and_then(|a| a.get("name"))
                            .and_then(|v| v.as_str())
                            .unwrap_or("未知歌手")
                            .to_string();
                        Some(Song { id, name, artist })
                    }).collect();

                    if !songs.is_empty() {
                        println!("🎵 搜索到 {} 首歌曲", songs.len());
                        self.set_songs(songs);
                        return true;
                    }
                }
            }
        }
        false
    }
}

pub async fn play_song(song: &Song) -> bool {
    println!("🎵 准备播放: {} - {}", song.artist, song.name);
    
    // 播报歌名
    let tts_msg = format!("为您播放 {} 的 {}", song.artist, song.name);
    let safe_tts = tts_msg.replace("'", "");
    let _ = run_shell(&format!("/usr/sbin/tts_play.sh '{}'", safe_tts)).await;

    // 获取播放地址
    let url_cmd = format!("curl -s \"https://kele.160622.xyz:14000/song/url/match?id={}\"", song.id);
    if let Ok(url_res) = run_shell(&url_cmd).await {
        // 打印原始响应用于调试
        println!("🔍 API 响应: {}", url_res.stdout);
        
        if let Ok(url_json) = serde_json::from_str::<serde_json::Value>(&url_res.stdout) {
            // API 可能返回两种格式:
            // 1. { code: 200, data: "https://..." }  // data 直接是 URL 字符串
            // 2. { code: 200, data: { url: "...", source: "..." } }  // data 是对象
            let play_url = url_json.get("data")
                .and_then(|d| {
                    // 先尝试作为字符串
                    if let Some(url_str) = d.as_str() {
                        Some(url_str)
                    } else {
                        // 再尝试作为对象获取 url 字段
                        d.get("url").and_then(|u| u.as_str())
                    }
                });
            
            if let Some(play_url) = play_url {
                println!("🎵 获取到播放地址: {}", play_url);
                // 延迟确保TTS播报不被立即打断
                sleep(Duration::from_secs(3)).await;
                
                let play_cmd = format!("ubus call mediaplayer player_play_url '{{\"url\":\"{}\",\"type\": 1}}'", play_url);
                let _ = run_shell(&play_cmd).await;
                return true;
            } else {
                println!("❌ 未能解析播放地址");
                println!("🔍 data 字段内容: {:?}", url_json.get("data"));
            }
        } else {
            println!("❌ JSON解析失败");
        }
    } else {
        println!("❌ 获取播放地址请求失败");
    }
    false
}

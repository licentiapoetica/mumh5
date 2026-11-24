use serde_json::{Value, json};
use tauri::{
    Manager, Runtime, State,
    plugin::{Builder, TauriPlugin},
};
#[cfg(target_os = "android")]
struct Voice<R: Runtime>(tauri::plugin::PluginHandle<R>);
#[cfg(not(target_os = "android"))]
struct Voice<R: Runtime>(std::marker::PhantomData<fn() -> R>);
impl<R: Runtime> Voice<R> {
    fn call(&self, method: &str, args: Value) -> Result<Value, String> {
        #[cfg(target_os = "android")]
        return self
            .0
            .run_mobile_plugin(method, args)
            .map_err(|e| e.to_string());
        #[cfg(not(target_os = "android"))]
        {
            let _ = (method, args);
            Ok(Value::Null)
        }
    }
}
#[tauri::command]
fn start<R: Runtime>(
    _app: tauri::AppHandle<R>,
    voice: State<'_, Voice<R>>,
    text: String,
) -> Result<Value, String> {
    voice.call("start", json!({"text":text}))
}
#[tauri::command]
fn stop<R: Runtime>(
    _app: tauri::AppHandle<R>,
    voice: State<'_, Voice<R>>,
) -> Result<Value, String> {
    voice.call("stop", json!({}))
}
#[tauri::command]
fn update<R: Runtime>(
    _app: tauri::AppHandle<R>,
    voice: State<'_, Voice<R>>,
    text: String,
    muted: bool,
    deafened: bool,
) -> Result<Value, String> {
    voice.call(
        "update",
        json!({"text":text,"muted":muted,"deafened":deafened}),
    )
}
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("voice")
        .invoke_handler(tauri::generate_handler![start, stop, update])
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            app.manage(Voice(
                api.register_android_plugin("org.mumh5.voice", "VoicePlugin")?,
            ));
            #[cfg(not(target_os = "android"))]
            {
                let _ = api;
                app.manage(Voice::<R>(std::marker::PhantomData));
            }
            Ok(())
        })
        .build()
}

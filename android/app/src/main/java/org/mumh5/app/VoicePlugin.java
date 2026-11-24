package org.mumh5.app;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import android.os.Build;

@CapacitorPlugin(name = "Voice", permissions = {
    @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
})
public class VoicePlugin extends Plugin {
    private static VoicePlugin current;

    @Override
    public void load() { current = this; }

    // From the notification buttons, to the page
    static void emitAction(String action) {
        if (current == null) return;
        JSObject data = new JSObject();
        data.put("action", action);
        current.notifyListeners("action", data);
    }

    @PluginMethod
    public void start(PluginCall call) {
        // The microphone service type needs the permission already granted; getUserMedia asks first.
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("no microphone permission");
            return;
        }
        // Without it the service still runs, but its notification is hidden. Ask once.
        SharedPreferences prefs = getContext().getSharedPreferences("voice", 0);
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED
            && !prefs.getBoolean("askedNotifications", false)) {
            prefs.edit().putBoolean("askedNotifications", true).apply();
            requestPermissionForAlias("notifications", call, "startAfterNotifications");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void startAfterNotifications(PluginCall call) {
        startService(call);
    }

    private void startService(PluginCall call) {
        keepPageVisible(true);
        Intent i = new Intent(getContext(), VoiceService.class);
        i.putExtra("text", call.getString("text", "In voice"));
        try {
            ContextCompat.startForegroundService(getContext(), i);
        } catch (RuntimeException e) {
            keepPageVisible(false);
            call.reject(e.getMessage());
            return;
        }
        // Doze cuts the network of apps that are not exempt, whatever wake locks they hold. Ask once.
        boolean exempt = getContext().getSystemService(PowerManager.class).isIgnoringBatteryOptimizations(getContext().getPackageName());
        SharedPreferences prefs = getContext().getSharedPreferences("voice", 0);
        if (!exempt && !prefs.getBoolean("askedBattery", false)) {
            prefs.edit().putBoolean("askedBattery", true).apply();
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getContext().getPackageName())));
            } catch (RuntimeException ignored) { /* no such screen on this device */ }
        }
        JSObject res = new JSObject();
        res.put("batteryExempt", exempt);
        call.resolve(res);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        keepPageVisible(false);
        getContext().stopService(new Intent(getContext(), VoiceService.class));
        call.resolve(new JSObject());
    }

    private void keepPageVisible(boolean keep) {
        if (getBridge().getWebView() instanceof VoiceWebView) {
            getActivity().runOnUiThread(() -> ((VoiceWebView) getBridge().getWebView()).setKeepVisible(keep));
        }
    }

    // Redraws the notification's text and buttons; does nothing while the service is not running
    @PluginMethod
    public void update(PluginCall call) {
        VoiceService service = VoiceService.instance;
        if (service != null) {
            String text = call.getString("text", "In voice");
            boolean muted = Boolean.TRUE.equals(call.getBoolean("muted", false));
            boolean deafened = Boolean.TRUE.equals(call.getBoolean("deafened", false));
            getActivity().runOnUiThread(() -> service.update(text, muted, deafened));
        }
        call.resolve(new JSObject());
    }
}

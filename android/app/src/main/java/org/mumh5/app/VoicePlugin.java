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
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "Voice")
public class VoicePlugin extends Plugin {
    @PluginMethod
    public void start(PluginCall call) {
        // The microphone service type needs the permission already granted; getUserMedia asks first.
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            call.reject("no microphone permission");
            return;
        }
        Intent i = new Intent(getContext(), VoiceService.class);
        i.putExtra("text", call.getString("text", "In voice"));
        try {
            ContextCompat.startForegroundService(getContext(), i);
        } catch (RuntimeException e) {
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
        getContext().stopService(new Intent(getContext(), VoiceService.class));
        call.resolve(new JSObject());
    }
}

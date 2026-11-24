package org.mumh5.app;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
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
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), VoiceService.class));
        call.resolve(new JSObject());
    }
}

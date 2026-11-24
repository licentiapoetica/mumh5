package org.mumh5.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(VoicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}

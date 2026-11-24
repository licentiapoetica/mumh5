package org.mumh5.app;

import android.content.Context;
import android.util.AttributeSet;
import android.view.View;
import com.getcapacitor.CapacitorWebView;

// Chromium freezes a page a minute after it became hidden, which stops its timers and audio. While
// voice runs the page is told its window is still visible, so it never becomes hidden.
public class VoiceWebView extends CapacitorWebView {
    private boolean keepVisible = false;

    public VoiceWebView(Context context, AttributeSet attrs) {
        super(context, attrs);
    }

    public void setKeepVisible(boolean keep) {
        if (keep == keepVisible) return;
        keepVisible = keep;
        // Tell the page what the window really is now
        onWindowVisibilityChanged(getWindowVisibility());
    }

    @Override
    protected void onWindowVisibilityChanged(int visibility) {
        super.onWindowVisibilityChanged(keepVisible ? View.VISIBLE : visibility);
    }
}

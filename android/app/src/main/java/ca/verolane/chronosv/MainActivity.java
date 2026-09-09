package ca.verolane.chronosv;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String ACTION_CAPTURE = "ca.verolane.chronosv.action.CAPTURE";
    private static final String EXTRA_HANDLED = "ca.verolane.chronosv.extra.HANDLED";
    private static final int MAX_SHARED_TEXT = 2000;

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        routeExternalIntent(intent);
    }

    private void routeExternalIntent(Intent intent) {
        if (intent == null || bridge == null || intent.getBooleanExtra(EXTRA_HANDLED, false)) {
            return;
        }

        String destination = null;
        if (Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            Uri.Builder builder = appPage("/capture");
            appendIfPresent(builder, "title", safeExtra(intent, Intent.EXTRA_SUBJECT));
            appendIfPresent(builder, "text", safeExtra(intent, Intent.EXTRA_TEXT));
            destination = builder.build().toString();
        } else if (ACTION_CAPTURE.equals(intent.getAction())) {
            destination = appPage("/capture").build().toString();
        } else if (Intent.ACTION_VIEW.equals(intent.getAction())) {
            destination = oauthReturnPage(intent.getData());
        }

        if (destination == null) return;
        intent.putExtra(EXTRA_HANDLED, true);
        final String url = destination;
        bridge.getWebView().post(() -> bridge.getWebView().loadUrl(url));
    }

    private Uri.Builder appPage(String path) {
        String base = bridge.getServerUrl() != null ? bridge.getServerUrl() : bridge.getAppUrl();
        return Uri.parse(base).buildUpon().encodedPath(path).clearQuery().fragment(null);
    }

    private String oauthReturnPage(Uri incoming) {
        if (incoming == null
            || !getString(R.string.custom_url_scheme).equals(incoming.getScheme())
            || !"oauth".equals(incoming.getHost())
            || !"/microsoft/return".equals(incoming.getPath())) {
            return null;
        }

        Uri.Builder builder = appPage("/oauth/microsoft/return");
        copyQueryParameter(incoming, builder, "success");
        copyQueryParameter(incoming, builder, "code");
        copyQueryParameter(incoming, builder, "error");
        copyQueryParameter(incoming, builder, "offline_access_allowed");
        return builder.build().toString();
    }

    private static void copyQueryParameter(Uri source, Uri.Builder destination, String name) {
        appendIfPresent(destination, name, safe(source.getQueryParameter(name)));
    }

    private static String safeExtra(Intent intent, String name) {
        CharSequence value = intent.getCharSequenceExtra(name);
        return value == null ? null : safe(value.toString());
    }

    private static String safe(String value) {
        if (value == null) return null;
        String cleaned = value.replace("\u0000", "").trim();
        if (cleaned.isEmpty()) return null;
        return cleaned.substring(0, Math.min(cleaned.length(), MAX_SHARED_TEXT));
    }

    private static void appendIfPresent(Uri.Builder builder, String name, String value) {
        if (value != null) builder.appendQueryParameter(name, value);
    }
}

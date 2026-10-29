package ca.verolane.chronosv;

import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private static final String ACTION_CAPTURE = "ca.verolane.chronosv.action.CAPTURE";
    private static final String EXTRA_HANDLED = "ca.verolane.chronosv.extra.HANDLED";
    private static final int MAX_SHARED_TEXT = 2000;

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        routeExternalIntent(getIntent());
    }

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
            destination = googleReturnPage(intent.getData());
            if (destination == null) destination = oauthReturnPage(intent.getData());
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

    private String googleReturnPage(Uri incoming) {
        if (incoming == null) return null;

        boolean customScheme =
            getString(R.string.custom_url_scheme).equals(incoming.getScheme())
                && "oauth".equals(incoming.getEncodedAuthority())
                && "/google/return".equals(incoming.getEncodedPath())
                && incoming.getFragment() == null;

        boolean verifiedAppLink =
            "https".equals(incoming.getScheme())
                && "verolane.online".equals(incoming.getHost())
                && incoming.getPort() == -1
                && incoming.getUserInfo() == null
                && "/auth/google-handoff".equals(incoming.getPath())
                && incoming.getQuery() == null
                && incoming.getFragment() != null;

        if (!customScheme && !verifiedAppLink) return null;

        // For HTTPS App Links, parse the fragment locally so the opaque handoff
        // never appears in the HTTP request or routine server access logs.
        Uri parameters = incoming;
        if (verifiedAppLink) {
            parameters = Uri.parse("https://verolane.online/auth/google-handoff?"
                + incoming.getFragment());
        }
        if (!validGoogleHandoffParameters(parameters, verifiedAppLink)) return null;

        Uri.Builder builder = appPage("/auth/google-return").appendQueryParameter("native", "1");
        appendIfPresent(builder, "handoff", parameters.getQueryParameter("handoff"));
        appendIfPresent(builder, "state", parameters.getQueryParameter("state"));
        return builder.build().toString();
    }

    private boolean validGoogleHandoffParameters(Uri incoming, boolean verifiedAppLink) {
        java.util.Set<String> names = incoming.getQueryParameterNames();
        if (verifiedAppLink) {
            if (names.size() != 3 || !names.contains("native")
                || !"1".equals(incoming.getQueryParameter("native"))) return false;
        } else if (names.size() != 2 || names.contains("native")) {
            return false;
        }

        if (!names.contains("handoff") || !names.contains("state")
            || incoming.getQueryParameters("handoff").size() != 1
            || incoming.getQueryParameters("state").size() != 1) return false;

        String handoff = incoming.getQueryParameter("handoff");
        String state = incoming.getQueryParameter("state");
        return handoff != null && handoff.length() <= 1800
            && handoff.matches("v1\\.[A-Za-z0-9_-]{16}\\.[A-Za-z0-9_-]{1,1500}\\.[A-Za-z0-9_-]{22}")
            && state != null && state.matches("[A-Za-z0-9_-]{43}");
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

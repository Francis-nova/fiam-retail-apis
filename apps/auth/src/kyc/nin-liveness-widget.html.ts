// Bridges QoreID's real Web SDK (https://docs.qoreid.com/docs/qoreid-web-sdk)
// into the mobile app via a WebView (see UploadNinSelfieScreen) — this is
// the only entitled, working path to QoreID's actual liveness product on
// this account: their React Native SDK requires an EAS/prebuild native
// build ("EXPO GO unsupported" per QoreID's own docs) that this
// Expo-managed-workflow project doesn't have, and the plain REST
// face-verification endpoint isn't a product this account is subscribed to
// (confirmed live: 403 "Not subscribed to this product"). `liveness_nin`,
// by contrast, mints real sessions (confirmed live: 201) — but Collection-
// mode products are SDK-submission-only by QoreID's own design (no public
// REST endpoint to submit a photo against a session), which is the whole
// point of a *liveness* check: it can't be satisfied by just POSTing an
// arbitrary already-taken image.
//
// Deliberately a static string, not a per-request template — every param
// the SDK needs is read client-side from `location.search` via
// URLSearchParams, so nothing user-controlled is ever interpolated into
// the HTML itself.
export const NIN_LIVENESS_WIDGET_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<script src="https://dashboard.qoreid.com/qoreid-sdk/qoreid.js"></script>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #000; font-family: -apple-system, sans-serif; }
  #status { color: #fff; display: flex; align-items: center; justify-content: center; height: 100%; font-size: 14px; padding: 24px; text-align: center; box-sizing: border-box; }
</style>
</head>
<body>
<div id="status">Loading verification…</div>
<script>
  function post(type, data) {
    var msg = JSON.stringify({ type: type, data: data || null });
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(msg);
    } else {
      console.log('[qoreid-widget]', msg);
    }
  }

  var params = new URLSearchParams(window.location.search);
  var token = params.get('token');
  var reference = params.get('reference');
  var nin = params.get('nin');
  var firstname = params.get('firstname');
  var lastname = params.get('lastname');

  function setStatus(text) {
    var el = document.getElementById('status');
    if (el) el.textContent = text;
  }

  if (!token || !window.QoreIdSDK) {
    setStatus('Unable to start verification. Close this and try again.');
    post('error', { message: 'Missing token or SDK failed to load' });
  } else {
    try {
      window.QoreIdSDK.init({
        token: token,
        customerReference: reference,
        identityData: { idType: 'NIN', idNumber: nin },
        applicantData: { firstname: firstname, lastname: lastname },
        initializedEventTrigger: function (e) {
          setStatus('');
          post('initialized', e);
        },
        submittedEventTrigger: function (e) {
          post('success', e);
        },
        errorEventTrigger: function (e) {
          post('error', e);
        },
        closedEventTrigger: function (e) {
          post('closed', e);
        },
      });
    } catch (e) {
      setStatus('Something went wrong starting verification.');
      post('error', { message: String(e && e.message ? e.message : e) });
    }
  }
</script>
</body>
</html>
`;

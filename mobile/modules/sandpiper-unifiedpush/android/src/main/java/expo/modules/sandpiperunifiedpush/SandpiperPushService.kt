package expo.modules.sandpiperunifiedpush

import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.PushService
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage

/**
 * Receives what the person's UnifiedPush distributor sends through the connector: a new endpoint (with
 * the RFC 8291 keys the connector made on this phone), a message (already decrypted by the connector),
 * a refused registration, or the end of the registration. Android may start it while the app is closed.
 */
class SandpiperPushService : PushService() {
  override fun onNewEndpoint(endpoint: PushEndpoint, instance: String) {
    if (instance != UnifiedPushState.INSTANCE) return
    UnifiedPushState.newEndpoint(applicationContext, endpoint)
  }

  override fun onMessage(message: PushMessage, instance: String) {
    if (instance != UnifiedPushState.INSTANCE) return
    // Only a message decrypted with this phone's keys and in the server's form is shown.
    val content = PushContentParser.parse(message.content, message.decrypted) ?: return
    Notifier.show(applicationContext, content)
  }

  override fun onRegistrationFailed(reason: FailedReason, instance: String) {
    if (instance != UnifiedPushState.INSTANCE) return
    UnifiedPushState.failed(reason.name)
  }

  override fun onUnregistered(instance: String) {
    if (instance != UnifiedPushState.INSTANCE) return
    UnifiedPushState.unregistered(applicationContext)
  }
}

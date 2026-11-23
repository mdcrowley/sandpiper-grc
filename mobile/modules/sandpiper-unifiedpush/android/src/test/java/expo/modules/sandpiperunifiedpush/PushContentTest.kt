package expo.modules.sandpiperunifiedpush

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// What the phone shows from a UnifiedPush message, and what it sends the server (E38-14).
class PushContentTest {
  private fun bytes(s: String) = s.toByteArray(Charsets.UTF_8)

  @Test
  fun showsTheServersUnreadMessage() {
    val c = PushContentParser.parse(bytes("""{"title":"Sandpiper GRC","body":"You have 2 new notifications","kind":"unread","count":2,"route":"/notifications"}"""), true)
    assertEquals(PushContent("Sandpiper GRC", "You have 2 new notifications", 2), c)
  }

  @Test
  fun showsTheAdministratorsTestPush() {
    val c = PushContentParser.parse(bytes("""{"title":"GRC","body":"This is a test notification.","kind":"unread","count":0}"""), true)
    assertEquals(0, c!!.count)
  }

  @Test
  fun ignoresAnythingElse() {
    val good = """{"title":"T","body":"You have 1 new notification","kind":"unread","count":1}"""
    assertNull("not decrypted with this phone's keys", PushContentParser.parse(bytes(good), false))
    assertNull(PushContentParser.parse(bytes("not json"), true))
    assertNull(PushContentParser.parse(ByteArray(0), true))
    assertNull(PushContentParser.parse(bytes("""{"title":"T","body":"B","kind":"record","count":1}"""), true))
    assertNull(PushContentParser.parse(bytes("""{"title":"T","body":"B","kind":"unread"}"""), true))
    assertNull(PushContentParser.parse(bytes("""{"title":"T","body":"B","kind":"unread","count":-1}"""), true))
    assertNull(PushContentParser.parse(bytes("""{"title":"T","body":"  ","kind":"unread","count":1}"""), true))
    assertNull(PushContentParser.parse(ByteArray(5000) { 'a'.code.toByte() }, true))
  }

  @Test
  fun keepsTextShortAndOnOneLine() {
    val c = PushContentParser.parse(bytes("""{"title":"${"x".repeat(100)}","body":"Line one\nline two\u0007","kind":"unread","count":1}"""), true)!!
    assertEquals(PushContentParser.MAX_TITLE, c.title.length)
    assertEquals("Line one line two", c.body)
    val untitled = PushContentParser.parse(bytes("""{"body":"B","kind":"unread","count":1}"""), true)!!
    assertEquals(PushContentParser.DEFAULT_TITLE, untitled.title)
  }

  // RFC 8291's example keys (base64url): a 65-byte P-256 public key and a 16-byte secret.
  private val pub = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
  private val auth = "BTBZMqHH6r4Tts7J_aSIgg"

  @Test
  fun sendsTheEndpointWithItsKeys() {
    val s = SubscriptionCheck.subscription("https://push.example.org/up/abc", pub, auth)!!
    assertEquals(mapOf("endpoint" to "https://push.example.org/up/abc", "p256dh" to pub, "auth" to auth), s.toMap())
    assertEquals(s, SubscriptionCheck.subscription("https://push.example.org/up/abc", pub, "$auth=="))
  }

  @Test
  fun refusesAnIncompleteSubscription() {
    assertNull(SubscriptionCheck.subscription(null, pub, auth))
    assertNull(SubscriptionCheck.subscription("ftp://push.example.org/x", pub, auth))
    assertNull(SubscriptionCheck.subscription("https://push.example.org/x", null, auth))
    assertNull(SubscriptionCheck.subscription("https://push.example.org/x", pub, null))
    assertNull(SubscriptionCheck.subscription("https://push.example.org/x", pub.drop(1), auth))
    assertNull(SubscriptionCheck.subscription("https://push.example.org/x", pub, "short"))
    assertNull(SubscriptionCheck.subscription("https://push.example.org/x", pub.replace('_', '/'), auth))
  }

  @Test
  fun checksTheServersKeyAndNamesFailures() {
    assertTrue(SubscriptionCheck.vapidValid(pub))
    assertFalse(SubscriptionCheck.vapidValid("not-a-key"))
    assertEquals("ERR_UNIFIEDPUSH_NETWORK", SubscriptionCheck.failureCode("NETWORK"))
    assertEquals("ERR_UNIFIEDPUSH_FAILED", SubscriptionCheck.failureCode("SOMETHING_NEW"))
  }

  @Test
  fun tellsANewEndpointFromTheSameOne() {
    val a = SubscriptionCheck.subscription("https://push.example.org/up/a", pub, auth)!!
    val b = SubscriptionCheck.subscription("https://push.example.org/up/b", pub, auth)!!
    assertEquals(SubscriptionCheck.fingerprint(a), SubscriptionCheck.fingerprint(a.copy()))
    assertNotEquals(SubscriptionCheck.fingerprint(a), SubscriptionCheck.fingerprint(b))
    assertEquals(32, SubscriptionCheck.fingerprint(a).length)
  }
}

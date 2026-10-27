package fish.nexa.ui.auth

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.BinaryBitmap
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import fish.nexa.Nexa
import fish.nexa.data.QrLogin
import fish.nexa.net.PublicUser
import fish.nexa.ui.Icon
import fish.nexa.ui.components.Avatar
import fish.nexa.ui.components.ButtonKind
import fish.nexa.ui.components.ButtonSize
import fish.nexa.ui.components.IconButton
import fish.nexa.ui.components.NxButton
import fish.nexa.ui.components.Txt
import fish.nexa.ui.describeError
import fish.nexa.ui.layers.Layer
import fish.nexa.ui.layers.Layers
import fish.nexa.ui.layers.openSheet
import fish.nexa.ui.settings.QrCode
import fish.nexa.ui.settings.describeDevice
import fish.nexa.ui.t
import fish.nexa.ui.theme.Nx
import fish.nexa.ui.theme.Radii
import kotlinx.coroutines.launch
import java.util.concurrent.Executors

/**
 * Letting another device in with a QR code (web/src/pages/QrApprovePage.tsx):
 * which device asks, and Log In or Cancel. Opened by the scanner in the status
 * sheet, or by a phone's own camera through the /login/qr link.
 */
fun openQrApprove(text: String) {
    val code = QrLogin.parse(text)
    if (code == null) {
        Nexa.ui.toast(t("qrLogin.notACode"), "error")
        return
    }
    val identity = Nexa.keys.identity ?: return
    Nexa.scope.launch {
        val device = try {
            describeDevice(QrLogin.scan(code.id))
        } catch (e: Exception) {
            Nexa.ui.toast(describeError(e, t("qrLogin.codeExpired")), "error")
            return@launch
        }
        var decided = false
        openSheet("qr-approve", closeButton = false, canClose = {
            // closing without a choice says no, so the other device is not left waiting
            if (!decided) Nexa.scope.launch { runCatching { QrLogin.deny(code.id) } }
            true
        }) { close ->
            val c = Nx.colors
            var busy by remember { mutableStateOf(false) }
            Column(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Box(Modifier.size(64.dp).background(c.brand.copy(alpha = 0.16f), androidx.compose.foundation.shape.CircleShape).border(1.dp, c.brand.copy(alpha = 0.42f), androidx.compose.foundation.shape.CircleShape), contentAlignment = Alignment.Center) {
                    Icon(if (device.icon.contains("Smartphone") || device.icon.contains("Tablet")) "Smartphone" else "Laptop", c.textBrand, size = 28.dp)
                }
                Txt(t("qrLogin.logInOnDevice", "device" to device.label), style = Nx.type.title.copy(fontSize = Nx.type.sp(22f)), color = c.textStrong, align = TextAlign.Center)
                fish.nexa.ui.chat.PersonText(Nexa.users.meId, t("qrLogin.asName", "name" to fish.nexa.ui.chat.PERSON_SLOT), (Nexa.users.me.value?.name ?: ""), style = Nx.type.body.copy(textAlign = TextAlign.Center), color = c.textMuted)
                Txt(
                    t("qrLogin.onlyIfYouOpenedIt"), style = Nx.type.bodySmall, color = c.text,
                    modifier = Modifier.fillMaxWidth().background(c.warning.copy(alpha = 0.12f), Radii.Sm).border(1.dp, c.warning.copy(alpha = 0.5f), Radii.Sm).padding(horizontal = 14.dp, vertical = 12.dp),
                )
                NxButton(t("login.logIn"), {
                    busy = true
                    Nexa.scope.launch {
                        try {
                            QrLogin.approve(code, identity)
                            decided = true
                            Nexa.ui.toast(t("qrLogin.theOtherDeviceIsSignedIn"), "success")
                            close()
                        } catch (e: Exception) {
                            Nexa.ui.toast(describeError(e, t("qrLogin.codeExpired")), "error")
                        } finally {
                            busy = false
                        }
                    }
                }, size = ButtonSize.LG, block = true, loading = busy)
                NxButton(t("qrLogin.cancel"), {
                    decided = true
                    Nexa.scope.launch { runCatching { QrLogin.deny(code.id) } }
                    close()
                }, kind = ButtonKind.SECONDARY, size = ButtonSize.LG, block = true, enabled = !busy)
            }
        }
    }
}

/** The camera, reading QR codes until one is a Nexa login code. */
fun openQrScanner() {
    lateinit var layer: Layer
    layer = Layer("qr-scan") { close ->
        QrScanner(onCode = { text ->
            close()
            openQrApprove(text)
        }, onClose = close)
    }
    Layers.open(layer)
}

@Composable
private fun QrScanner(onCode: (String) -> Unit, onClose: () -> Unit) {
    val c = Nx.colors
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var allowed by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed = it }
    LaunchedEffect(Unit) { if (!allowed) ask.launch(Manifest.permission.CAMERA) }
    Box(Modifier.fillMaxSize().background(Color.Black)) {
        if (allowed) {
            var found by remember { mutableStateOf(false) }
            val worker = remember { Executors.newSingleThreadExecutor() }
            DisposableEffect(Unit) { onDispose { worker.shutdown() } }
            AndroidView(factory = { ctx ->
                val view = PreviewView(ctx)
                val future = ProcessCameraProvider.getInstance(ctx)
                future.addListener({
                    val provider = future.get()
                    val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
                    val reader = QRCodeReader()
                    val analysis = ImageAnalysis.Builder().setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST).build()
                    analysis.setAnalyzer(worker) { image ->
                        try {
                            val plane = image.planes[0]
                            val buf = plane.buffer
                            val bytes = ByteArray(buf.remaining()).also { buf.get(it) }
                            val source = PlanarYUVLuminanceSource(bytes, plane.rowStride, image.height, 0, 0, image.width, image.height, false)
                            val text = runCatching { reader.decode(BinaryBitmap(HybridBinarizer(source))).text }.getOrNull()
                            if (text != null && !found && QrLogin.parse(text) != null) {
                                found = true
                                ContextCompat.getMainExecutor(ctx).execute { provider.unbindAll(); onCode(text) }
                            }
                        } finally {
                            reader.reset()
                            image.close()
                        }
                    }
                    provider.unbindAll()
                    provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
                }, ContextCompat.getMainExecutor(ctx))
                view
            }, modifier = Modifier.fillMaxSize(), onRelease = { ProcessCameraProvider.getInstance(it.context).get().unbindAll() })
            // where to hold the code
            Box(Modifier.align(Alignment.Center).size(240.dp).border(3.dp, Color.White.copy(alpha = 0.9f), Radii.Lg))
        }
        Column(
            Modifier.align(Alignment.BottomCenter).fillMaxWidth().safeDrawingPadding().padding(24.dp).background(c.bgFloating.copy(alpha = 0.92f), Radii.Lg).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Txt(t("android.qrLogin.scanTitle"), style = Nx.type.heading, color = c.textStrong)
            Txt(if (allowed) t("android.qrLogin.scanHint") else t("android.qrLogin.cameraNeeded"), style = Nx.type.bodySmall, color = c.textMuted)
        }
        // on a dark disc, so it shows over whatever the camera sees
        Box(Modifier.safeDrawingPadding().padding(12.dp).background(Color.Black.copy(alpha = 0.5f), androidx.compose.foundation.shape.CircleShape)) {
            IconButton("X", t("qrLogin.cancel"), onClose, tint = Color.White)
        }
    }
}

/** The sign-in page's QR code on a wide screen (web/src/pages/QrSignIn.tsx). */
@Composable
fun QrSignInPanel(modifier: Modifier = Modifier, onError: (String) -> Unit) {
    val c = Nx.colors
    var link by remember { mutableStateOf<String?>(null) }
    var scanned by remember { mutableStateOf<PublicUser?>(null) }
    LaunchedEffect(Unit) {
        try {
            val (me, token, identity) = QrLogin.waitForSignIn { w ->
                when (w) {
                    is QrLogin.Wait.Showing -> { link = w.link; scanned = null }
                    is QrLogin.Wait.Scanned -> scanned = w.user
                }
            }
            Nexa.auth.loginWith(me, token, identity)
        } catch (e: kotlinx.coroutines.CancellationException) {
            throw e
        } catch (_: Exception) {
            onError(t("qrLogin.couldNotSignIn"))
        }
    }
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        val who = scanned
        if (who != null) {
            Box(Modifier.size(200.dp).background(c.brand.copy(alpha = 0.14f), Radii.Lg), contentAlignment = Alignment.Center) {
                Avatar(who.id, who.name, who.avatarId, 96.dp)
            }
            Txt(t("qrLogin.checkYourPhone"), style = Nx.type.heading.copy(fontSize = Nx.type.sp(19f)), color = c.textStrong, align = TextAlign.Center)
            fish.nexa.ui.chat.PersonText(who.id, t("qrLogin.approveAs", "name" to fish.nexa.ui.chat.PERSON_SLOT), who.name, style = Nx.type.bodySmall.copy(textAlign = TextAlign.Center), color = c.textMuted)
        } else {
            val l = link
            if (l != null) QrCode(l, 200.dp, t("qrLogin.title")) else Box(Modifier.size(200.dp).background(Color.White, Radii.Lg))
            Txt(t("qrLogin.title"), style = Nx.type.heading.copy(fontSize = Nx.type.sp(19f)), color = c.textStrong, align = TextAlign.Center)
            Txt(t("qrLogin.hint"), style = Nx.type.bodySmall.copy(textAlign = TextAlign.Center), color = c.textMuted)
        }
    }
}

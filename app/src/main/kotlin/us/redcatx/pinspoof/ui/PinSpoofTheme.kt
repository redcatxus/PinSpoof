package us.redcatx.pinspoof.ui

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val FallbackDarkScheme = darkColorScheme(
    primary = Color(0xFF7AD6A8),
    onPrimary = Color(0xFF003823),
    primaryContainer = Color(0xFF005235),
    onPrimaryContainer = Color(0xFF96F3C3),
    secondary = Color(0xFFB4CCB9),
    onSecondary = Color(0xFF203527),
    secondaryContainer = Color(0xFF364B3D),
    onSecondaryContainer = Color(0xFFD0E8D5),
    surface = Color(0xFF0F1512),
    surfaceContainer = Color(0xFF1B211E),
    surfaceContainerHigh = Color(0xFF262C28),
)

private val FallbackLightScheme = lightColorScheme(
    primary = Color(0xFF006C48),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF96F3C3),
    onPrimaryContainer = Color(0xFF002114),
    secondary = Color(0xFF4D6354),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFD0E8D5),
    onSecondaryContainer = Color(0xFF0B1F14),
)

@Composable
fun PinSpoofTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit
) {
    val context = LocalContext.current
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> FallbackDarkScheme
        else -> FallbackLightScheme
    }

    MaterialExpressiveTheme(
        colorScheme = colorScheme,
        motionScheme = MotionScheme.expressive(),
        content = content
    )
}

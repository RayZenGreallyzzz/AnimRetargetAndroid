package com.retarget.app

import com.retarget.app.bvh.BvhParser
import com.retarget.app.bvh.BvhWriter
import com.retarget.app.math.Math3D
import com.retarget.app.retarget.Retargeter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Locale
import kotlin.math.abs
import kotlin.math.acos

class RetargetCoreTest {
    private fun errorDeg(a: FloatArray, b: FloatArray): Double {
        val dot = (0..3).sumOf { a[it].toDouble() * b[it] }
        return 2 * acos(abs(dot).coerceIn(-1.0, 1.0)) * 180 / Math.PI
    }

    private fun bvh(angles: String, rootHeight: Int = 100) = BvhParser.parse("""HIERARCHY
ROOT Hips
{
  OFFSET 0 0 0
  CHANNELS 6 Xposition Yposition Zposition Zrotation Yrotation Xrotation
  JOINT LeftUpLeg
  {
    OFFSET 0 -50 0
    CHANNELS 3 Zrotation Yrotation Xrotation
    JOINT LeftLeg
    {
      OFFSET 0 -50 0
      CHANNELS 3 Zrotation Yrotation Xrotation
      End Site
      {
        OFFSET 0 -2 0
      }
    }
  }
}
MOTION
Frames: 1
Frame Time: 0.033333
0 $rootHeight 0 $angles 0 0 0 0 0 0
""".trimIndent())

    @Test fun importedBvhRotationChannelOrderIsCorrect() {
        val src = Retargeter.BvhSource(bvh("90 0 0"))
        val want = Math3D.fromEuler(floatArrayOf(0f, 0f, 90f), "ZYX")
        assertTrue("Z rotation was decoded as X", errorDeg(src.globalQ(0, 0), want) < 0.1)
    }

    @Test fun bvhExportWritesZYXChannelsNotXYZ() {
        val want = Math3D.fromEuler(floatArrayOf(0f, 0f, 90f), "ZYX")
        val r = Retargeter.Result(listOf("Hips"), intArrayOf(-1),
            arrayOf(floatArrayOf(0f, 0f, 0f)), arrayOf(floatArrayOf(0f, 1f, 0f)),
            arrayOf(arrayOf(want)))
        val out = StringBuilder().also { BvhWriter.write(r, 30f, it) }.toString()
        val result = Retargeter.BvhSource(BvhParser.parse(out))
        assertTrue(errorDeg(result.globalQ(0, 0), want) < 0.1)
        assertTrue("Zrotation must be the first rotation channel", out.lineSequence().last { it.isNotBlank() }.matches(Regex("\\s*0\\.00 100\\.00 0\\.00 90\\.00.*")))
    }

    @Test fun worldDeltaIsAppliedInWorldSpace() {
        val bind = Math3D.fromEuler(floatArrayOf(30f, 0f, 0f), "XYZ")
        val swing = Math3D.fromEuler(floatArrayOf(0f, 70f, 0f), "XYZ")
        val animated = Math3D.qMul(swing, bind)
        val src = object : Retargeter.Source {
            override val jointNames = listOf("Hips")
            override val parentIdx = intArrayOf(-1)
            override val bindGlobalQ = listOf(bind)
            override val bindGlobalT = listOf(floatArrayOf(0f, 1f, 0f))
            override val bindRootPos = floatArrayOf(0f, 1f, 0f)
            override val frames = 1
            override val fps = 30f
            override fun globalQ(f: Int, j: Int) = animated
            override fun rootPos(f: Int) = floatArrayOf(0f, 1f, 0f)
            override fun legLength() = 0f
        }
        val target = listOf(Retargeter.TNode("Hips", -1, floatArrayOf(0f, 1f, 0f), bind, floatArrayOf(0f, 1f, 0f)))
        val result = Retargeter.retarget(target, 0, src, Retargeter.Options(false, false))
        assertTrue("Noncommuting world swing should not be changed", errorDeg(result.localQ[0][0], animated) < 0.1)
    }

    @Test fun inPlaceBvhStillUsesCentimeters() {
        val target = Retargeter.buildTargetFromBvh(bvh("0 0 0", rootHeight = 0)).first
        assertEquals(-0.50f, target[1].lclT[1], 1e-5f)
    }

    @Test fun outputIsLocaleIndependent() {
        val before = Locale.getDefault()
        try {
            Locale.setDefault(Locale("ru", "RU"))
            val src = Retargeter.BvhSource(bvh("0 0 0"))
            val res = Retargeter.retarget(Retargeter.buildTargetFromBvh(bvh("0 0 0")).first,
                0, src, Retargeter.Options(false, false))
            val s = StringBuilder().also { BvhWriter.write(res, 30f, it) }.toString()
            assertTrue(!s.contains(Regex("\\d,\\d")))
        } finally { Locale.setDefault(before) }
    }
}

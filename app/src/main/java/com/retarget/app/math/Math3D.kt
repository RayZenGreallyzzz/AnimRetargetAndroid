package com.retarget.app.math

/**
 * Кватернионы [x, y, z, w], векторы FloatArray(3).
 * Композиция эйлеров: R = R_axisA * R_axisB * R_axisC (как в FBX / BVH).
 */
object Math3D {

    val IDENTITY_Q = floatArrayOf(0f, 0f, 0f, 1f)

    fun qMul(a: FloatArray, b: FloatArray): FloatArray {
        val (x1, y1, z1, w1) = listOf(a[0], a[1], a[2], a[3])
        val (x2, y2, z2, w2) = listOf(b[0], b[1], b[2], b[3])
        return floatArrayOf(
            w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
            w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
            w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
            w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2
        )
    }

    fun qConj(q: FloatArray) = floatArrayOf(-q[0], -q[1], -q[2], q[3])

    fun qNorm(q: FloatArray): FloatArray {
        val n = kotlin.math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])
        return if (n < 1e-12f) IDENTITY_Q.copyOf() else floatArrayOf(q[0] / n, q[1] / n, q[2] / n, q[3] / n)
    }

    /** Повернуть вектор кватернионом. */
    fun qRot(q: FloatArray, v: FloatArray): FloatArray {
        val (x, y, z, w) = listOf(q[0], q[1], q[2], q[3])
        val (vx, vy, vz) = listOf(v[0], v[1], v[2])
        return floatArrayOf(
            (1 - 2 * (y * y + z * z)) * vx + 2 * (x * y - z * w) * vy + 2 * (x * z + y * w) * vz,
            2 * (x * y + z * w) * vx + (1 - 2 * (x * x + z * z)) * vy + 2 * (y * z - x * w) * vz,
            2 * (x * z - y * w) * vx + 2 * (y * z + x * w) * vy + (1 - 2 * (x * x + y * y)) * vz
        )
    }

    private val AX = mapOf('X' to 0, 'Y' to 1, 'Z' to 2)

    private fun qAxis(axis: Char, angleRad: Float): FloatArray {
        val c = kotlin.math.cos(angleRad / 2f)
        val s = kotlin.math.sin(angleRad / 2f)
        return when (axis) {
            'X' -> floatArrayOf(s, 0f, 0f, c)
            'Y' -> floatArrayOf(0f, s, 0f, c)
            else -> floatArrayOf(0f, 0f, s, c)
        }
    }

    /**
     * Эйлеры (градусы, порядок осей в строке, например "XYZ", "ZXY") -> кватернион.
     * Композиция: R = R{o0} * R{o1} * R{o2}.
     */
    fun fromEuler(e: FloatArray, order: String): FloatArray {
        val a = qAxis(order[0], Math.toRadians(e[AX[order[0]]!!].toDouble()).toFloat())
        val b = qAxis(order[1], Math.toRadians(e[AX[order[1]]!!].toDouble()).toFloat())
        val c = qAxis(order[2], Math.toRadians(e[AX[order[2]]!!].toDouble()).toFloat())
        return qNorm(qMul(qMul(a, b), c))
    }

    /**
     * Кватернион -> эйлеры (градусы) для композиции R = Rz*Ry*Rx (порядок "ZYX").
     * Используется при экспорте BVH. Проверено roundtrip-тестом (ошибка < 1e-6).
     */
    fun toEulerZYX(q: FloatArray): FloatArray {
        val (x, y, z, w) = listOf(q[0], q[1], q[2], q[3])
        val r00 = 1 - 2 * (y * y + z * z); val r01 = 2 * (x * y - z * w); val r02 = 2 * (x * z + y * w)
        val r10 = 2 * (x * y + z * w); val r11 = 1 - 2 * (x * x + z * z); val r12 = 2 * (y * z - x * w)
        val r20 = 2 * (x * z - y * w); val r21 = 2 * (y * z + x * w); val r22 = 1 - 2 * (x * x + y * y)
        var sy = -r20
        sy = sy.coerceIn(-1f, 1f)
        val th = kotlin.math.asin(sy)
        val ps: Float; val ph: Float
        if (kotlin.math.abs(sy) < 0.99999f) {
            ps = kotlin.math.atan2(r10.toDouble(), r00.toDouble()).toFloat()
            ph = kotlin.math.atan2(r21.toDouble(), r22.toDouble()).toFloat()
        } else {
            ps = kotlin.math.atan2(-r12.toDouble(), r11.toDouble()).toFloat()
            ph = 0f
        }
        val e = FloatArray(3)
        e[AX['Z']!!] = Math.toDegrees(ps.toDouble()).toFloat()
        e[AX['Y']!!] = Math.toDegrees(th.toDouble()).toFloat()
        e[AX['X']!!] = Math.toDegrees(ph.toDouble()).toFloat()
        return e
    }

    fun vAdd(a: FloatArray, b: FloatArray) = floatArrayOf(a[0] + b[0], a[1] + b[1], a[2] + b[2])
    fun vSub(a: FloatArray, b: FloatArray) = floatArrayOf(a[0] - b[0], a[1] - b[1], a[2] - b[2])
    fun vScale(a: FloatArray, s: Float) = floatArrayOf(a[0] * s, a[1] * s, a[2] * s)
    fun vLen(a: FloatArray) = kotlin.math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
    fun vDot(a: FloatArray, b: FloatArray) = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    fun vCross(a: FloatArray, b: FloatArray) = floatArrayOf(
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    )
    fun vNorm(a: FloatArray): FloatArray {
        val l = vLen(a)
        return if (l < 1e-12f) floatArrayOf(0f, 0f, 0f) else floatArrayOf(a[0] / l, a[1] / l, a[2] / l)
    }

    /** Кватернион из оси (не обязательно нормализованной) и угла в радианах. */
    fun qFromAxisAngle(axis: FloatArray, angleRad: Float): FloatArray {
        val l = vLen(axis)
        if (l < 1e-12f) return IDENTITY_Q.copyOf()
        val s = kotlin.math.sin(angleRad / 2f) / l
        return qNorm(floatArrayOf(axis[0] * s, axis[1] * s, axis[2] * s, kotlin.math.cos(angleRad / 2f)))
    }

    /** Минимальный поворот, отображающий вектор u в вектор v (оба нормализуются внутри). */
    fun qBetween(u: FloatArray, v: FloatArray): FloatArray {
        val un = vNorm(u); val vn = vNorm(v)
        val c = vDot(un, vn).coerceIn(-1f, 1f)
        val ax = vCross(un, vn)
        return if (vLen(ax) < 1e-9f) {
            if (c > 0f) IDENTITY_Q.copyOf()
            else qFromAxisAngle(floatArrayOf(1f, 0f, 0f), Math.PI.toFloat()) // 180°, ось любая перпендикулярная
        } else qFromAxisAngle(ax, kotlin.math.acos(c.toDouble()).toFloat())
    }
}

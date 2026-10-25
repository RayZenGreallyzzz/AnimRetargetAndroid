package com.retarget.app.bvh

/**
 * BVH: иерархия + MOTION. Система координат — как в файле (обычно Y-up, сантиметры).
 */
class BvhJoint(
    val name: String,
    val offset: FloatArray,          // смещение от родителя (единицы файла)
    val channels: List<String>       // например ["Zrotation","Xrotation","Yrotation"]
) {
    var parent: BvhJoint? = null
    val children = mutableListOf<BvhJoint>()
    var isRoot: Boolean = false
}

class Bvh(
    val root: BvhJoint,
    val frameTime: Float,            // секунды
    val frames: Int,
    val motion: Array<FloatArray>    // [frame][все каналы по иерархии]
) {
    /** Порядок обхода суставов, совпадает с порядком каналов в motion. */
    val order: List<BvhJoint> = buildList {
        fun rec(j: BvhJoint) { add(j); j.children.forEach { rec(it) } }
        rec(root)
    }
    val channelsPerJoint: List<Int> = order.map { it.channels.size }
    private val starts: List<Int> = buildList {
        var s = 0
        for (c in channelsPerJoint) { add(s); s += c }
    }

    /** Индекс первого КАНАЛА ВРАЩЕНИЯ кости (у корня перед ними стоят позиции). */
    val rotStart: List<Int> = buildList {
        var s = 0
        for (j in order) {
            var rs = s
            for (c in j.channels) if (c.endsWith("position", ignoreCase = true)) rs++ else break
            add(rs)
            s += j.channels.size
        }
    }

    /** Поворот в массиве XYZ независимо от последовательности каналов BVH. */
    fun eulers(f: Int, j: BvhJoint): FloatArray {
        val idx = order.indexOf(j)
        require(idx >= 0) { "BVH: unknown joint" }
        val e = FloatArray(3)
        val start = starts[idx]
        for ((channel, name) in j.channels.withIndex()) {
            if (!name.endsWith("rotation", ignoreCase = true)) continue
            val axis = "XYZ".indexOf(name[0].uppercaseChar())
            if (axis >= 0) e[axis] = motion[f][start + channel]
        }
        return e
    }

    /** Root position in XYZ axes regardless of channel order. */
    fun rootPos(f: Int): FloatArray {
        val p = FloatArray(3)
        for ((channel, name) in root.channels.withIndex()) {
            if (!name.endsWith("position", ignoreCase = true)) continue
            val axis = "XYZ".indexOf(name[0].uppercaseChar())
            if (axis >= 0) p[axis] = motion[f][starts[0] + channel]
        }
        return p
    }
}

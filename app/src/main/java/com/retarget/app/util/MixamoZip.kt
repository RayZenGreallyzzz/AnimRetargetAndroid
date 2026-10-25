package com.retarget.app.util

import java.util.zip.ZipInputStream

/** Распаковка Mixamo ZIP: находим первый .bvh внутри архива. */
object MixamoZip {

    fun extractBvh(bytes: ByteArray): Pair<String, ByteArray>? {
        val zis = ZipInputStream(bytes.inputStream())
        try {
            var entry = zis.nextEntry
            while (entry != null) {
                if (!entry.isDirectory && entry.name.lowercase().endsWith(".bvh")) {
                    val out = ByteArrayOutputStream()
                    val buf = ByteArray(65536)
                    while (true) {
                        val n = zis.read(buf)
                        if (n <= 0) break
                        out.write(buf, 0, n)
                    }
                    return entry.name to out.toByteArray()
                }
                entry = zis.nextEntry
            }
            return null
        } finally {
            zis.close()
        }
    }

    private class ByteArrayOutputStream {
        private val buf = java.io.ByteArrayOutputStream()
        fun write(b: ByteArray, off: Int, len: Int) = buf.write(b, off, len)
        fun toByteArray(): ByteArray = buf.toByteArray()
    }
}

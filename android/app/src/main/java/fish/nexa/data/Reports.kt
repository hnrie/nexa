package fish.nexa.data

import fish.nexa.Nexa
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
data class SafetyReport(
    val id: String,
    @SerialName("reporter_id") val reporterId: String = "0",
    @SerialName("target_kind") val targetKind: String = "other",
    @SerialName("target_id") val targetId: String = "0",
    @SerialName("subject_id") val subjectId: String = "0",
    @SerialName("server_id") val serverId: String = "0",
    val part: String = "whole",
    @SerialName("custom_part") val customPart: String = "",
    val reason: String = "other",
    val description: String = "",
    val excerpt: String = "",
    val snapshot: JsonObject = JsonObject(emptyMap()),
    val status: String = "open",
    @SerialName("assigned_to") val assignedTo: String = "0",
    val version: Int = 1,
    @SerialName("created_at") val createdAt: Long = 0,
    @SerialName("updated_at") val updatedAt: Long = 0,
)

@Serializable
data class SafetyReportTarget(
    val kind: String,
    val id: String,
    val parts: List<String>,
    val snapshot: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class SafetyReportEvent(
    val id: String,
    @SerialName("actor_id") val actorId: String,
    val status: String,
    @SerialName("assigned_to") val assignedTo: String = "0",
    val note: String = "",
    @SerialName("created_at") val createdAt: Long,
)

@Serializable
data class SafetyReportDetail(
    val report: SafetyReport,
    val events: List<SafetyReportEvent> = emptyList(),
    val files: List<NexaFile> = emptyList(),
    val people: Map<String, NexaPerson> = emptyMap(),
)

@Serializable
data class SafetyReportList(
    val reports: List<SafetyReport> = emptyList(),
    val counts: Map<String, Int> = emptyMap(),
    @SerialName("has_more") val hasMore: Boolean = false,
)

data class ReportEvidence(val part: String, val label: String, val text: String)

data class ReportContext(
    val kind: String? = null,
    val id: String? = null,
    val serverId: String? = null,
    val part: String? = null,
    val evidence: List<ReportEvidence> = emptyList(),
)

object Reports {
    val kinds =
        listOf(
            "user",
            "server",
            "channel",
            "message",
            "emoji",
            "sticker",
            "pack",
            "note",
            "application",
            "role",
            "other",
        )
    val reasons =
        listOf(
            "harassment",
            "hate",
            "sexual",
            "violence",
            "child_safety",
            "spam",
            "scam",
            "privacy",
            "illegal",
            "other",
        )
    val statuses = listOf("open", "in_review", "actioned", "dismissed")

    private fun query(values: Map<String, String>) =
        values.entries
            .filter { it.value.isNotEmpty() }
            .joinToString("&", "?") { (k, v) -> "$k=" + java.net.URLEncoder.encode(v, "UTF-8") }

    suspend fun target(kind: String, id: String, server: String?) =
        Nexa.api.get(
            "/reports/target" +
                query(mapOf("kind" to kind, "id" to id, "server_id" to (server ?: ""))),
            SafetyReportTarget.serializer(),
        )

    suspend fun send(body: JsonObject): String =
        (Nexa.api.request("POST", "/reports", body).jsonObject["report"]!!.jsonObject["id"]
                as JsonPrimitive)
            .content

    suspend fun list(
        status: String,
        kind: String,
        search: String,
        mine: Boolean,
        before: String = "",
    ) =
        Nexa.api.get(
            "/moderation/reports" +
                query(
                    mapOf(
                        "status" to status,
                        "kind" to kind,
                        "q" to search,
                        "mine" to if (mine) "1" else "",
                        "before" to before,
                    )
                ),
            SafetyReportList.serializer(),
        )

    suspend fun detail(id: String) =
        Nexa.api.get("/moderation/reports/$id", SafetyReportDetail.serializer())

    suspend fun review(
        v: SafetyReport,
        status: String,
        note: String,
        assigned: String,
    ): SafetyReportDetail =
        Nexa.api.request(
            "PATCH",
            "/moderation/reports/${v.id}",
            SafetyReportDetail.serializer(),
            buildJsonObject {
                put("version", v.version)
                put("status", status)
                put("note", note)
                put("assigned_to", assigned)
            },
        )

    /** Copy readable fields deliberately; never serialize att keys or the whole payload. */
    fun evidence(message: ChatMessage): List<ReportEvidence> {
        val p = message.payload ?: return emptyList()
        return buildList {
            fun addPart(
                part: String,
                text: String,
                label: String = fish.nexa.ui.t("reports.part.$part"),
            ) {
                if (text.isNotBlank()) add(ReportEvidence(part, label, text))
            }
            addPart("text", listOfNotNull(p.fwdComment, p.t).joinToString("\n"))
            p.att?.forEach { addPart("attachment", it.name, it.name) }
            p.sticker?.let { addPart("sticker", "${it.name ?: ""} (${it.id})") }
            p.embeds?.forEach { e ->
                addPart(
                    "embed",
                    listOf("title", "description", "url")
                        .mapNotNull { (e[it] as? JsonPrimitive)?.contentOrNull }
                        .joinToString("\n"),
                )
            }
            p.poll?.let {
                addPart("poll", it.question + "\n" + it.answers.joinToString("\n") { a -> a.text })
            }
        }
    }
}

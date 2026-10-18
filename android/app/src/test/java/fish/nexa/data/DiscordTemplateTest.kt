package fish.nexa.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Discord server template link parsing as lib/discordTemplate.test.ts has it. */
class DiscordTemplateTest {
    @Test fun parsesTemplateLinksAndCodes() {
        assertEquals(Invites.ParsedTemplate.Ok("hgM48av5Q69A"), Invites.parseDiscordTemplate("hgM48av5Q69A"))
        assertEquals(Invites.ParsedTemplate.Ok("6exdzMgjZgah"), Invites.parseDiscordTemplate("  https://discord.new/6exdzMgjZgah  "))
        assertEquals(Invites.ParsedTemplate.Ok("fVfBazbqjhXg"), Invites.parseDiscordTemplate("discord.new/fVfBazbqjhXg?x=1#y"))
        assertEquals(Invites.ParsedTemplate.Ok("2TffvPucqHkN"), Invites.parseDiscordTemplate("https://discord.com/template/2TffvPucqHkN"))
        assertEquals(Invites.ParsedTemplate.Ok("2TffvPucqHkN"), Invites.parseDiscordTemplate("https://discordapp.com/templates/2TffvPucqHkN/"))
        assertEquals(Invites.ParsedTemplate.Ok("2TffvPucqHkN"), Invites.parseDiscordTemplate("https://ptb.discord.com/template/2TffvPucqHkN"))
        assertEquals(Invites.ParsedTemplate.Ok("2TffvPucqHkN"), Invites.parseDiscordTemplate("https://discord.com/api/v10/guilds/templates/2TffvPucqHkN"))
    }

    @Test fun distinguishesInviteLinks() {
        assertEquals(Invites.ParsedTemplate.Err("invite"), Invites.parseDiscordTemplate("https://discord.gg/abc123"))
        assertEquals(Invites.ParsedTemplate.Err("invite"), Invites.parseDiscordTemplate("https://discord.com/invite/abc123"))
    }

    @Test fun rejectsInvalidLinksAndIdentifiesExplicitUrls() {
        assertEquals(Invites.ParsedTemplate.Err("empty"), Invites.parseDiscordTemplate(""))
        assertEquals(Invites.ParsedTemplate.Err("invalid"), Invites.parseDiscordTemplate("https://example.com/template/2TffvPucqHkN"))
        assertTrue(Invites.isDiscordTemplateUrl("https://discord.new/2TffvPucqHkN"))
        assertFalse(Invites.isDiscordTemplateUrl("2TffvPucqHkN"))
    }
}

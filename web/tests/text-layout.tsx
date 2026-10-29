/** Dev-only browser regression fixture. Not a Vite build entry or app route. */
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import "@/styles/base.css";
import { Twemoji } from "@/components/common/Twemoji";
import { RoleIcon } from "@/components/common/RoleIcon";
import { StyledTyping } from "@/components/chat/TypingLine";
import { PersonName } from "@/components/common/PersonName";
import { ScrollingText } from "@/components/common/ScrollingText";
import { InviteView } from "@/components/invite/InviteView";
import { Markdown } from "@/markdown";
import { RichEmbeds } from "@/components/chat/webhook/RichEmbeds";
import { ServerCard } from "@/components/discovery/DiscoveryPage";
import { Button } from "@/components/common/Button";
import { TextInput } from "@/components/common/TextInput";
import settings from "@/components/settings/Settings.module.css";
import { t } from "@/i18n";
import chat from "@/components/chat/Chat.module.css";
import role from "@/components/server/RoleChips.module.css";
import forum from "@/components/forum/Forum.module.css";
import modal from "@/components/common/Modal.module.css";
import notes from "@/components/notes/Notes.module.css";
import hook from "@/components/chat/webhook/Webhook.module.css";
import side from "@/components/sidebar/Sidebar.module.css";
import embed from "@/components/chat/Embeds.module.css";
import profile from "@/components/profile/Profile.module.css";
import typing from "@/components/chat/Typing.module.css";
import template from "@/components/modals/ServerModals.module.css";
import bugs from "@/components/bugs/Bugs.module.css";
import emojiDetails from "@/components/chat/EmojiDetails.module.css";
import widgets from "@/components/profile/Widgets.module.css";
import look from "@/components/settings/look/Look.module.css";
import picker from "@/components/pickers/Picker.module.css";
import forms from "@/components/apps/AppForm.module.css";
import composer from "@/components/composer/Composer.module.css";
import server from "@/components/server/ServerSettings.module.css";
import nexa from "@/components/nexa/Nexa.module.css";
import voice from "@/components/voice/Voice.module.css";
import { useUsers } from "@/stores/users";
import { useSettings } from "@/stores/settings";

useSettings.setState({ loaded: true });
useUsers.setState({ byId: { "1": { id: "1", display_name: "Audit", username: "audit", name_style: null } as never } });
document.body.style.overflow = "auto";
document.body.style.height = "auto";

function Audit() {
  const [text, setText] = useState("A readable name");
  const [body, setBody] = useState("A readable message");
  Object.assign(window, { setAuditText: (name: string, message: string) => { setText(name); setBody(message); } });
  const target = { kind: "group" as const, id: null, name: text, description: body, icon: null, banner: null, online: null, members: 3 };
  const ctx = { users: { "1": { display_name: text, username: "alice" } }, channels: { "1": { name: text } }, roles: { "1": { name: text, color: 0 } }, emojiUrl: () => "" };
  return <MemoryRouter><main style={{ padding: 12, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", gap: 16, maxWidth: 1000, margin: "auto" }}>
    <section data-boundary="account-removal" className={settings.dangerBox}>
      <span className={settings.hint} style={{ margin: 0 }}>{t("settings.account.deletingYourAccountIsPermanentYour")}</span>
      <Button data-action data-full-label variant="danger">{t("settings.account.deleteAccount")}</Button>
    </section>
    <section data-boundary="legal-report" className={settings.legalReportRow}>
      <TextInput placeholder={t("settings.admin.legal.usernameOrAccountId")} />
      <Button data-action data-full-label size="sm" disabled>{t("settings.admin.legal.compileReport")}</Button>
    </section>
    <section data-boundary="chat" className={chat.chat} style={{ height: 560, background: "var(--bg-raised)" }}>
      <header className={chat.header}>
        <button className={chat.hGroup}><i style={{ flex: "none", width: 24 }}>◉</i><span data-lines="1" className={chat.hName} dir="auto">{text}</span></button>
        <div className={chat.hSpacer} />
        {["⌕", "☎", "▣"].map((x) => <button key={x} data-action className={chat.hBtn}>{x}</button>)}
      </header>
      <div className={chat.scroll} data-scroll="chat"><div className={chat.inner}>
        <div className={chat.empty}>
          <h2 data-lines="2" className={chat.emptyName}>{text}</h2>
          <p className={chat.emptyText}>Welcome to <b>{text}</b>. Messages here are end-to-end encrypted.</p>
        </div>
        <div className={chat.msg} data-boundary="message"><div className={chat.content}><Markdown source={body} ctx={ctx} /></div></div>
      </div></div>
    </section>
    <div data-boundary="invite"><InviteView variant="card" target={target} actions={<Button>Join</Button>} /></div>
    <div data-boundary="invite-dialog"><InviteView variant="dialog" target={target} actions={<Button>Join</Button>} /></div>
    <div data-boundary="invite-page"><InviteView variant="page" target={target} actions={<Button>Join</Button>} /></div>
    <div data-boundary="discovery"><ServerCard card={{ id: "1", name: text, description: body, tags: [text], member: true, member_count: 3, online_count: 2 } as never} onOpen={() => {}} onTag={() => {}} /></div>
    <section data-boundary="identities" style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <i style={{ flex: "none", width: 32 }}>◉</i><PersonName data-lines="1">{text}</PersonName><button data-action style={{ flex: "none" }}>Action</button>
    </section>
    <section data-boundary="sidebar" className={side.item} style={{ width: 260 }}><div className={side.text}><span className={side.name}>{text}</span><ScrollingText>{text}</ScrollingText></div><button data-action>×</button></section>
    <section data-boundary="roles" className={role.chips}><span className={role.chip}><i className={role.chipDot} /><span>{text}</span><button data-action className={role.chipX}>×</button></span></section>
    <section data-boundary="forum"><span className={forum.tag}><span>{text}</span></span><h3 data-lines="2" className={forum.postTitle}>{text}</h3><p className={forum.postWords}>{body}</p></section>
    <section data-boundary="modal"><header className={modal.header}><h2 data-lines="2" className={modal.title}>{text}</h2><button data-action className={modal.close}>×</button></header></section>
    <section data-boundary="note"><h2 data-lines="2" className={notes.readTitle}>{text}</h2><div className={notes.read}><Markdown source={body} ctx={ctx} /></div></section>
    <section data-boundary="embed" className={embed.card}><span data-lines="3" className={embed.title}>{text}</span><div className={embed.desc} data-open="true">{body}</div></section>
    <section data-boundary="webhook" className={hook.embed}><div className={hook.grid}><div className={hook.author}><i className={hook.authorIcon}>◉</i><span>{text}</span></div><div data-lines="3" className={hook.title}>{text}</div><div className={hook.description}><Markdown source={body} ctx={ctx} /></div><div className={hook.fields}><div className={hook.field}><div data-lines="3" className={hook.fieldName}>{text}</div><div className={hook.fieldValue}>{body}</div></div></div></div></section>
    {["solid", "gradient", "glow", "ink", "pop", "candy", "aurora", "chrome", "holo", "neon", "flame"].map((effect) => <section key={effect} data-boundary={`effect-${effect}`} style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <PersonName data-lines="1" user={{ id: "2", name_style: { font: "comic", effect, colors: [0xff8844, 0x8844ff] } }}>{text}</PersonName><button data-action style={{ flex: "none" }}>Action</button>
    </section>)}
    <section data-boundary="rich-embed"><RichEmbeds hook={{ name: text, content: "", tts: false, embeds: [{ type: "rich", title: text, url: "https://example.com", author: { name: text, url: "https://example.com" }, description: body, fields: [{ name: text, value: body, inline: false }], footer: { text } }], components: [], attachments: [], link_embeds: [], stickers: [] }} /></section>
    <section data-boundary="system" className={chat.system}><span>Opened <button className={chat.sysLink}>{text}</button>.</span><button data-action style={{ flex: "none" }}>View</button></section>
    <section data-boundary="profile" className={profile.ident}><div className={profile.nameRow}><h2 className={profile.display}><PersonName>{text}</PersonName></h2><button data-action>Note</button></div></section>
    <section data-boundary="emoji"><button className={chat.pill}><span data-emoji-slot><Twemoji text={"😀".repeat(16)} fallbackClassName={chat.pillEmoji} /></span><span>12</span></button><span data-emoji-slot><RoleIcon icon={{ kind: "emoji", name: text, text }} size={20} /></span></section>
    <section data-boundary="typing" className={typing.stage}><StyledTyping style={{ emoji: [], motion: "still", words: text.slice(0, 32) }} name={text} size="big" /></section>
    <section data-boundary="template" className={template.templateCard}>
      <p data-lines="2" className={template.templateTitle}>{text}</p><div className={template.templateRoles}><span className={template.rolePill}><i className={template.roleDot} /><span data-lines="1">{text}</span></span></div>
      <div className={template.templateTree}><div data-lines="1" className={template.templateCat}>{text}</div><div className={template.templateChans}><span className={template.templateChan}><i>#</i><span data-lines="1">{text}</span><i>⌑</i></span></div></div>
    </section>
    <section data-boundary="metadata">
      <Button data-action>{text}</Button>
      {[bugs.feedTitle, emojiDetails.name, chat.lockedTitle, hook.voterHead, look.cardName, voice.ringSub].map((className) => <div key={className} data-lines="2" className={className}>{text}</div>)}
      <div className={widgets.stats}><dl className={widgets.stat}><dt data-lines="2">{text}</dt><dd data-lines="2">{text}</dd></dl></div>
      <div style={{ paddingInline: 8 }}><button className={profile.listItem}><span className={profile.listInitial}>{text.slice(0, 1)}</span><span data-lines="1" className={profile.listName}>{text}</span></button></div>
      <div data-lines="1" className={picker.section}>{text}</div>
      <label className={forms.check}><input type="checkbox" /><span className={forms.checkText}><span data-lines="2">{text}</span></span></label>
      <div data-lines="1" className={server.keyName}>{text}</div><span data-lines="1" className={nexa.personUser}>@{text}</span>
      <div className={composer.cmdBox}><span className={composer.slot}><span data-lines="1" className={composer.slotName}>{text}</span><span className={composer.slotGrow}><input value="answer" readOnly /></span><button data-action className={composer.slotRemove}>×</button></span></div>
    </section>
    <section data-boundary="voice"><div data-lines="1" className={voice.ringName}>{text}</div></section>
  </main></MemoryRouter>;
}
createRoot(document.getElementById("root")!).render(<Audit />);

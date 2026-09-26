# Findings — i18n-copy

(Summary is written at the top when the audit is done.)

Conventions used below: "en" is `web/src/i18n/locales/en.json`; a locale is named by its file
stem (`de`, `pt-BR`, …). "All eleven files" means en plus the ten translations. Where a finding
gives corrected text, it is meant to be applied verbatim; where it gives translations for a new
key, they were written by this audit and read against the register each locale already uses.

---

### I18N-001 · P2 · i18n · The typing bar glues names to a verb fragment and hard-codes "and", on both platforms
- Where: `web/src/components/chat/TypingBar.tsx:20-22`, `android/app/src/main/java/xyz/evilion/chat/ui/chat/ChatScreen.kt:393-396`, en `chat.typingBar.isTyping`, `chat.typingBar.areTyping`
- What: "{name} is typing…" is built as `<b>{name}</b> {t("chat.typingBar.isTyping")}`; two and three names are joined with a literal ` and ` / `, ` in JSX (web) and `", "` (Android). The catalogue only ever sees "is typing…" / "are typing…".
- Impact: in every language the web shows an English "and" between the names ("Ana and Bob schreiben …"). Languages that attach a particle to the name or inflect the verb for the subject cannot be right at all: ja translated the fragment as "が入力中…", ko as "님이 입력 중…", so the screen shows "Ana が入力中…" with a stray space, and for two people "Ana and Bob が入力中…". hi "टाइप कर रहा है…" is masculine singular whoever is typing; ar "يكتب…" likewise.
- Fix: replace the two fragments with three whole sentences that take the names as placeholders, rendered through `<Tr>` on the web (names stay bold) and `t(key, "a" to …)` on Android; delete `isTyping`/`areTyping` from all eleven files.
  - `chat.typingBar.oneIsTyping` — en "{a} is typing…" · de "{a} schreibt …" · fr "{a} est en train d’écrire…" · es "{a} está escribiendo…" · pt-BR "{a} está digitando…" · ru "{a} печатает…" · ar "{a} يكتب…" · ja "{a}が入力中…" · ko "{a}님이 입력 중…" · zh-CN "{a} 正在输入…" · hi "{a} लिख रहे हैं…"
  - `chat.typingBar.twoAreTyping` — en "{a} and {b} are typing…" · de "{a} und {b} schreiben …" · fr "{a} et {b} sont en train d’écrire…" · es "{a} y {b} están escribiendo…" · pt-BR "{a} e {b} estão digitando…" · ru "{a} и {b} печатают…" · ar "{a} و{b} يكتبان…" · ja "{a}と{b}が入力中…" · ko "{a}님과 {b}님이 입력 중…" · zh-CN "{a} 和 {b} 正在输入…" · hi "{a} और {b} लिख रहे हैं…"
  - `chat.typingBar.threeAreTyping` — en "{a}, {b} and {c} are typing…" · de "{a}, {b} und {c} schreiben …" · fr "{a}, {b} et {c} sont en train d’écrire…" · es "{a}, {b} y {c} están escribiendo…" · pt-BR "{a}, {b} e {c} estão digitando…" · ru "{a}, {b} и {c} печатают…" · ar "{a} و{b} و{c} يكتبون…" · ja "{a}、{b}、{c}が入力中…" · ko "{a}님, {b}님, {c}님이 입력 중…" · zh-CN "{a}、{b} 和 {c} 正在输入…" · hi "{a}, {b} और {c} लिख रहे हैं…"
  - `chat.typingBar.severalPeopleAreTyping` stays.
- Effort: S
- Status: open

### I18N-002 · P2 · ux · Labels mix Title Case and sentence case, often inside one menu
- Where: en, 228 keys (list and corrected text in `audit/r2/areas/i18n-copy/en-sentence-case.json`, key → new English; plural objects included whole)
- What: 247 short labels are Title Case while the rest of the catalogue, and everything written for Android, is sentence case. The two styles sit side by side: the message menu shows `chat.messageItem.pinMessage` "Pin Message" above `chat.messageItem.selectMessage` "Select message"; `chat.messageMenu.selectMessages` "Select Messages" vs `chat.messageItem.selectMessage`; the same tooltip exists twice as `chat.messageItem.addReaction` "Add Reaction" and `chat.reactions.addReaction` "Add reaction"; `settings.settings.logOut` "Log Out" vs `settings.devices.logOut` "Log out"; `voice.voice.fullScreen` "Full Screen" vs `chat.videoPlayer.fullScreen` "Full screen"; web `chat.chat.pinnedMessages` "Pinned Messages" vs Android `chatScreen.pinnedMessages` "Pinned messages" for the same button.
- Impact: the app reads as two products stitched together; every Title Case string is also one more thing a translator has to decide about (de/fr/es already use their own casing, so only en changes).
- Fix: sentence case everywhere. Apply the mapping file to en only (proper nouns and acronyms are preserved: Nexa, Discord, Klipy, Windows, GIF, ID, DM, SHA-256, Rich Presence; "Do Not Disturb" becomes "Do not disturb"). `settings.settings.logOut` is mapped to "Sign out" per I18N-013. Then re-run `tools/i18n_check.py` (placeholders are untouched, so it stays green).
- Effort: S (mechanical)
- Status: open

### I18N-003 · P2 · ux · Confirmations ask "Are you sure you want to…?" instead of saying what will happen
- Where: en `chat.messageMenu.areYouSureYouWantTo`, `chat.selectionBar.areYouSureDeleteMessages`, `server.channelSettings.deleteChannelHint`, `sidebar.serverMenu.areYouSureYouWantToDeleteChannel`, `server.memberAction.confirmBan`, `server.memberAction.confirmKick`, `sidebar.serverMenu.areYouSureYouWantToLeave`, `modals.modalHost.areYouSure`; callers in `web/src/components/chat/messageMenu.ts:96`, `web/src/components/chat/SelectionBar.tsx:44`, `web/src/components/sidebar/serverMenu.ts:79,122`
- What: every confirm dialog already has a title that names the action ("Delete message", "Leave 'x'"), so the body repeats the question and, in four of the seven, says nothing about the consequence. The two ways to delete a channel (sidebar menu vs channel settings) show different bodies for the same act.
- Impact: people click through "Are you sure?" without learning that a deleted message goes for everyone, or that leaving needs a new invite.
- Fix (bodies; titles stay):
  - `chat.messageMenu.areYouSureYouWantTo` → "This message is removed for everyone in the conversation. This cannot be undone."
  - `chat.selectionBar.areYouSureDeleteMessages` → one: "This message is removed for everyone. This cannot be undone." · other: "These {count} messages are removed for everyone. This cannot be undone."
  - `server.channelSettings.deleteChannelHint` and `sidebar.serverMenu.areYouSureYouWantToDeleteChannel` → both "Every message in #{name} is deleted for everyone. This cannot be undone." (then keep one key and point both callers at it)
  - `server.memberAction.confirmBan` → "{name} is removed from the server and cannot come back until the ban is lifted."
  - `server.memberAction.confirmKick` → "{name} is removed from the server and can come back with a new invite."
  - `sidebar.serverMenu.areYouSureYouWantToLeave` → "You stop receiving messages from {name}. You need a new invite to come back."
  - `modals.modalHost.areYouSure` "Are you sure?" is the fallback title in `ModalHost.tsx:59`; every caller passes a title, so it is unreachable — leave it or set it to "Confirm".
  Translations follow the same shape; the fix agent should re-translate these seven in all ten locales (they are short).
- Effort: S
- Status: open

### I18N-004 · P3 · ux · Exclamation marks, and three spellings of "Copied"
- Where: en, ten strings
- What: the brief's tone is no exclamation marks; ten strings shout, and the "copied" toast exists as "Copied!" (`chat.groupMemberMenu.copied`), "Copied" (`modals.groupInvite.copied`) and "Link copied." / "User ID copied." (`chat.messageMenu.linkCopied`, `friends.userIdCopied`).
- Fix:
  - `chat.groupMemberMenu.copied` "Copied!" → "Copied." · `modals.groupInvite.copied` "Copied" → "Copied."
  - `chat.messageList.welcomeToChannel` "Welcome to #{name}!" → "Welcome to #{name}"
  - `friends.friendRequestSent` "Success! Your friend request to {name} was sent." → "Friend request sent to {name}."
  - `friends.youAreNowFriends` "You and {name} are now friends!" → "You and {name} are now friends."
  - `friends.youReAlreadyFriendsWithThat` "You're already friends with that user!" → "You are already friends."
  - `login.welcomeBack` "Welcome back!" → "Welcome back" (Android's `auth.authScreen.welcomeBack` already reads so)
  - `login.weReSoExcitedToSee`, `modals.customStatus.supportHasArrived`, `server.channelSettings.letEveryoneKnowHowToUse`, `server.settingsLayer.carefulYouHaveUnsavedChanges` — see I18N-005.
- Effort: S
- Status: open

### I18N-005 · P3 · ux · Discord's microcopy was carried over word for word
- Where: en (the same text is then in all ten translations)
- What: a dozen strings are Discord's own UI text, including its jokes and marketing register, which the owner has rejected elsewhere. A product that is "the chat app you already know, with the parts it is missing filled in" should not literally reuse the other app's copy.
- Fix:
  - `login.weReSoExcitedToSee` "We're so excited to see you again!" → "Sign in to pick up where you left off."
  - `modals.customStatus.supportHasArrived` "Support has arrived!" (placeholder) → "What are you up to?"
  - `modals.customStatus.whatSCookin` "What's cookin', {name}?" → "What are you up to, {name}?"
  - `server.channelSettings.letEveryoneKnowHowToUse` "Let everyone know how to use this channel!" (topic placeholder) → "What is this channel for?"
  - `server.settingsLayer.carefulYouHaveUnsavedChanges` "Careful — you have unsaved changes!" → "You have unsaved changes."
  - `settings.appearance.lookAtMeIMA` "Look at me I'm a beautiful butterfly. Fluttering in the moonlight 🌝" (font-size preview; the only emoji in the catalogue) → "This is how messages will look at this size." (each locale writes its own natural sentence; no emoji)
  - `friends.hmDidnTWorkDoubleCheck` "Hm, didn't work. Double check that the username is correct." → "Nobody has that username. Check the spelling."
  - `friends.youCanTAddYourselfBut` "You can't add yourself, but we admire the confidence." → "You cannot add yourself."
  - `server.channelSettings.usersWillNeedToConfirmThey` "Users will need to confirm they are of legal age to view the content in this channel." → "People must confirm they are of legal age before they can see this channel."
  - `modals.createChannel.sendMessagesImagesGifsEmojiOpinions` "Send messages, images, GIFs, emoji, opinions and puns" → "Messages, images, GIFs and emoji"
  - `modals.createChannel.hangOutTogetherWithVoiceVideo` "Hang out together with voice, video, and screen share" → "Voice, video and screen share"
  - `modals.createServer.yourServerIsWhereYouAnd` "Your server is where you and your friends hang out. Make yours and start talking. Everything in it is end-to-end encrypted." → "A server is a place for you and your friends. Everything in it is end-to-end encrypted."
  - `modals.serverNotifications.mutingAServerPreventsUnreadIndicators` "Muting a server prevents unread indicators and notifications from appearing unless you are mentioned." → "A muted server shows no unread marks and sends no notifications unless you are mentioned."
  - `chat.pins.thisChannelDoesnTHaveAny` "This channel doesn't have any pinned messages… yet." → "No pinned messages yet. Pin one from a message's menu."
  - `chat.messageItem.clickToSeeAttachment` "Click to see attachment" → "Attachment" (it is the quoted preview of a reply target; see I18N-023)
  - `composer.composer.pingOn` "@ ON" / `composer.composer.pingOff` "@ OFF" → "Notify: on" / "Notify: off"
- Effort: S
- Status: open

### I18N-006 · P3 · ux · "Please" in three strings
- Where: en `captcha.theCaptchaCheckFailedPleaseTry`, `captcha.theCaptchaTimedOutPleaseTry`, `register.somethingWentWrongPleaseTryAgain`
- Fix: "The captcha check did not pass. Try again." · "The captcha timed out. Try again." · "Something went wrong. Try again."
- Effort: S
- Status: open

### I18N-007 · P2 · ux · Errors that say "failed"/"invalid" and do not say what to do
- Where: en, listed below; `web/src/pages/GuestCallPage.tsx:199,276`, `web/src/pages/InvitePage.tsx:82,146`, `android/.../ui/invite/InviteScreen.kt:58`
- What: the brief's bar is "what happened and what to do". These say neither in a way a person can act on, and two of them are the same sentence under two keys.
- Fix:
  - `chat.messageItem.messageFailedToSend` "Message failed to send." → "Not sent." (a Retry button sits beside it; matches Android, I18N-018)
  - `composer.composer.uploadFailed` "Upload failed." → "The upload did not finish. Try again."
  - `download.theDownloadFailed` "The download failed." → "The download did not finish. Try again."
  - `guestCall.thisLinkIsInvalidOrHasExpired` and `guestCall.thisLinkIsInvalidOrHas` (identical text, two keys, GuestCallPage.tsx:199 and :276) → one key, "This link no longer works. Ask the person who sent it for a new one."
  - `invite.inviteInvalid` "Invite Invalid" (page title) → "This invite no longer works"; `invite.thisInviteIsInvalidOrHasExpired` (its body) → "It has expired, was revoked, or was used up. Ask for a new one."; Android `invite.inviteScreen.thisInviteIsNotValidAny` "This invite is not valid any more." → the same body text (parity).
  - `recover.recoveryFailedCheckTheKeyAnd` "Recovery failed. Check the key and try again." → "That recovery key did not work. Check it and try again."
  - `server.emoji.uploadFailedFor` "{name}: upload failed." → "{name} could not be uploaded."
  - `modals.confirm.somethingWentWrong` "Something went wrong." → "Something went wrong. Try again."
  - `friends.youAlreadySentARequestTo` "You already sent a request to that user." → "You already sent them a request."
  - `friends.youCanTSendARequest` "You can't send a request to this user." → "You cannot send a request to this person."
  - `guestCall.thisCallIsGone` "This call is gone." (the `ended` reason) → "The call has ended."
  - `download.theAndroidDownloadCouldNotBe` "The Android download could not be loaded. That is this page failing to ask, not the app being unavailable." → "The Android download could not be loaded. Reload the page to try again."
  - `attachments.theUploadLostItsPlace` "The upload lost its place." → "The upload lost its place. Try again."
- Effort: S
- Status: open

### I18N-008 · P2 · i18n · Invite headings end in a dangling preposition, with the name on the next line
- Where: `web/src/components/chat/Embeds.tsx:246` (`chat.embeds.youHaveBeenInvitedToJoin`), `web/src/pages/InvitePage.tsx:153` (`invite.invitedYouToJoin`, `invite.youveBeenInvited`), `android/.../ui/invite/InviteScreen.kt:83` (`invite.inviteScreen.youHaveBeenInvitedTo`)
- What: "You have been invited to join" is a kicker; the server or group name is a separate element below it. English survives that. The translations end on a preposition that expects the name to follow in the same sentence: es "Te han invitado a unirte a", pt-BR "Você recebeu um convite para entrar em", ru "Вас пригласили в", ar "تلقّيت دعوة للانضمام إلى", fr "Vous êtes invité à rejoindre".
- Impact: five of ten languages show a broken half-sentence on every invite embed and on the invite page.
- Fix: make the kickers whole sentences.
  - `chat.embeds.youHaveBeenInvitedToJoin`, `invite.youveBeenInvited`, `invite.inviteScreen.youHaveBeenInvitedTo` → en "You have an invite" · de "Du hast eine Einladung" · fr "Vous avez une invitation" · es "Tienes una invitación" · pt-BR "Você recebeu um convite" · ru "Вам прислали приглашение" · ar "لديك دعوة" · ja "招待が届いています" · ko "초대를 받았습니다" · zh-CN "你收到了一份邀请" · hi "आपको एक न्योता मिला है"
  - `invite.invitedYouToJoin` "{name} invited you to join" → en "An invite from {name}" · de "Eine Einladung von {name}" · fr "Une invitation de {name}" · es "Una invitación de {name}" · pt-BR "Um convite de {name}" · ru "Приглашение от {name}" · ar "دعوة من {name}" · ja "{name} さんからの招待" · ko "{name}님의 초대" · zh-CN "来自 {name} 的邀请" · hi "{name} की ओर से न्योता"
- Effort: S
- Status: open

### I18N-009 · P2 · i18n · [web-chat-ui] The invite embed's member and online counts are English built with "s"
- Where: `web/src/components/chat/Embeds.tsx:242-243`
- What: `` `${e.member_count} member${e.member_count === 1 ? "" : "s"}` `` and `` `${e.online_count} online` `` are hard-coded; this is exactly the `{n} item(s)` shape the plural mechanism exists for, and `invite.membersCount` / `invite.onlineCount` already exist for the invite page.
- Impact: every invite embed shows "12 members · 3 online" in English in all ten languages.
- Fix: `t("invite.membersCount", { count })` and `t("invite.onlineCount", { count })` (after I18N-002 they read "{count} members" / "{count} online").
- Effort: S
- Status: open

### I18N-010 · P2 · i18n · Sentences assembled in code from translated pieces
- Where and fix, one per line:
  - `web/src/components/modals/InviteModal.tsx:87` — hint = (`modals.invite.yourInviteLinkExpiresOn` | `modals.invite.yourInviteLinkExpiresNever`) + (`modals.invite.andCanBeUsedTimes` " and can be used {count} times")? + "." — a sentence in four pieces with the full stop added in code, no plural for one use, and the English "Your invite link expires never" is not a sentence. Replace with four whole strings and delete the three: `modals.invite.expiresOn` "Your invite link expires on {when}." · `modals.invite.expiresNever` "Your invite link never expires." · `modals.invite.expiresOnUses` {one: "Your invite link expires on {when} and can be used once.", other: "Your invite link expires on {when} and can be used {count} times."} · `modals.invite.expiresNeverUses` {one: "Your invite link never expires and can be used once.", other: "Your invite link never expires and can be used {count} times."}
  - `web/src/pages/DownloadPage.tsx:226` — `make the AppImage executable (` is hard-coded English, followed by `<code>chmod +x</code>` and the fragment `download.andRunItItUpdatesItself` ") and run it; it updates itself. …". Replace with one string rendered through `<Tr>`: `download.linuxFirstRun` "Make the AppImage executable ({command}) and run it; it updates itself. The .deb installs with your package manager and says when a new version is out." with `command` = `<code>chmod +x</code>`; delete `download.andRunItItUpdatesItself`.
  - `web/src/components/modals/QuickSwitcher.tsx:202` — `{typeToSearch…} <b>from:me</b> {modals.quickSwitcher.findsWhatYouSent}`. Replace the fragment with `modals.quickSwitcher.fromMeFindsWhatYouSent` "{query} finds what you sent." via `<Tr>` with `query` = `<b>from:me</b>` (ja/ko/hi put the verb after the object, so the split cannot be translated today).
  - `web/src/components/settings/SecurityPage.tsx:212` — `backupCodesLeftCount` + `settings.security.onSince` " · on since {when}" (a string starting with a separator). Fold into one plural: `settings.security.backupCodesLeftSince` {one: "{count} backup code left · on since {when}", other: "{count} backup codes left · on since {when}"}; delete `onSince`.
  - `settings.desktop.lastChecked` " Last checked {when}." (leading space, appended to another sentence — see the caller in DesktopPage.tsx; give it a span of its own or one combined string).
  - `settings.settingsScreen.thisDevice` "This device · " (Android; trailing separator) → "This device", join with " · " in code.
  - `voice.shareScreen.sharesAtYourScreenSOwn` "Shares at your screen's own resolution. " (trailing space) → strip it; the caller adds the space.
- Effort: M (several small edits on the web, one on Android)
- Status: open

### I18N-011 · P2 · i18n · Noun fragments substituted into placeholders that need a grammatical case
- Where: en `chat.groupMemberMenu.itsCurrentOwner` (used for `{owner}` in `youBecomeTheOwnerInPlaceOf` / `theyBecomeTheOwnerInPlaceOf`, `groupMemberMenu.ts:47`), `chat.messageList.thisConversation` (for `{where}` in `subchatStart`, `MessageList.tsx:409`), `modals.invite.theServer` (for `{name}` in `inviteFriendsTo`, `InviteModal.tsx:80`), `modals.serverProfile.thisServer` (for `{name}` in `howYouAppearIn`), `encryption.yourOwnKey` (for `{name}` in the safety-number strings, `VerifyKeyModal.tsx:7`), `passcode.you` (for `{name}` in `passcode.enterYourPasscodeToUnlock`, `PasscodePage.tsx:62`), `shell.user.theNewVersion` (for `{version}` in `shell.user.restartToUpdateTo`, `UserPanel.tsx:132`)
- What: when a real name is not available, a translated noun phrase is dropped into the slot. A name does not inflect; a noun phrase must. The translators, seeing only "its current owner", chose the nominative: ru "вместо {owner}" needs the genitive but `itsCurrentOwner` is "нынешний владелец" → "вместо нынешний владелец" (ungrammatical); de "anstelle von {owner}" needs the dative but has "der aktuelle Besitzer"; hi "{owner} की जगह" needs the oblique "इसके मौजूदा मालिक" but has "इसका मौजूदा मालिक"; ru `thisConversation` is "этом разговоре" (prepositional) after "внутри" which takes the genitive ("внутри этого разговора"). "Read these digits out to your own key" is wrong in English too.
- Fix: give the no-name case its own whole sentence instead of a substitute noun, and delete the fragments:
  - `chat.groupMemberMenu.youBecomeTheOwnerInPlaceOfTheCurrent` "You become the group's owner in place of its current owner." and `chat.groupMemberMenu.theyBecomeTheOwnerInPlaceOfTheCurrent` "{name} becomes the group's owner in place of its current owner."
  - `chat.messageList.subchatStartHere` "A subchat inside this conversation, for everyone already in it. It has its own key, so what is said here is encrypted separately."
  - `modals.invite.inviteFriendsToTheServer` "Invite friends to the server"
  - `modals.serverProfile.howYouAppearInThisServer` "How you appear in this server. Leave it empty to use your display name."
  - `passcode.enterYourPasscodeToUnlockNoName` — the same sentence without the name (exact text in the addendum once range 4 is read).
  - `shell.user.restartToUpdate` "Restart to update" (no version).
  - `encryption.yourOwnKey`: for one's own key the modal should use copy without a `{name}`; the fix agent should check `KeyVerifyBody` for which strings receive `name` in the self case.
  - `chat.systemMessage.aMessage` ("{actor} pinned {message}") and `modals.stickerPack.someoneNoLongerHere` ("Created by" + name) are the same shape but every locale happens to work (accusative = nominative for these nouns); leave them.
- Effort: M
- Status: open

### I18N-012 · P2 · bug · Two display-picker strings carry the HTML entity `&amp;` and render it literally
- Where: en `desktop.displayPicker.openPrivacyAmpSecurityScreenRecording` "Open Privacy &amp; Security → Screen Recording and switch Nexa on.", `desktop.displayPicker.restartingUsuallySettlesItIfIt` "… open Privacy &amp; Security → …"; rendered as React text in `web/src/components/desktop/DisplayPicker.tsx:56,60`
- What: the extraction tool copied JSX-escaped text into JSON; React escapes text nodes, so the user sees "Privacy &amp; Security".
- Impact: the one screen a Mac user reaches when screen sharing has no permission shows garbage in the middle of the instruction, in all eleven languages that kept the entity.
- Fix: replace `&amp;` with `&` in both keys in every locale file (`grep -l '&amp;' web/src/i18n/locales/*.json`).
- Effort: S
- Status: open

### I18N-013 · P2 · ux · "Sign in", "Log in" and "Register"/"Create account" are all in use, sometimes on one page
- Where: en; `web/src/pages/LoginPage.tsx:129,150,152`
- What: 17 strings say sign in/out/up (everything on Android and in prose), 10 say log in/out (web buttons and the settings menu). The login page's password button is "Log In" (`login.logIn`), its two-factor button "Sign in" (`login.signIn`), and the link under it is the hard-coded English "Need an account? Register" (`login.register`; the "Need an account?" part is untranslated). Registration is "Register" (`login.register`), "Create account" (`auth.authScreen.createAccount`) and "Create an account" (`home.hero.start`).
- Fix: "sign in/out" everywhere, "Create account" for the action, "sign up" only in prose:
  - `home.nav.logIn` → "Sign in" · `login.logIn` → "Sign in" · `invite.logInToAccept` → "Sign in to accept" · `recover.backToLogIn` → "Back to sign in" · `lock.logOutInstead` → "Sign out instead" (Android has `auth.authScreen.signOutInstead` for the same button — use one key) · `settings.settings.logOut` → "Sign out" · `settings.devices.logOut` → "Sign out" · `settings.devices.logOutAllOtherDevices` → "Sign out all other devices" · `settings.devices.logThemOut` (range 7) → "Sign them out" · `passcode.tooManyWrongTriesLogIn` → "Too many wrong tries. Sign in with your password to get back in." · `settings.admin.theyAreLoggedOutEverywhereAnd` → "They are signed out everywhere and cannot sign in until re-enabled. Their messages stay."
  - `login.register` → "Create account"; `invite.needAnAccountRegister` "Need an account? Register" → "Need an account? Create one"; LoginPage.tsx:152 should use `invite.needAnAccountRegister` through `<Tr>` instead of the literal "Need an account?" ([web-shell-ui] for the code side).
- Effort: S
- Status: open

### I18N-014 · P3 · ux · Contractions in 21 strings against 100+ that spell "cannot / could not / do not"
- Where: en
- What: the catalogue's voice is uncontracted (27 "cannot", 53 "could not", 22 "do/does/did not"); 21 strings say "can't/don't/doesn't/didn't/won't/isn't", often next to an uncontracted neighbour ("Those passwords do not match." vs "Dots can't lead, trail or repeat."). Pick one; the majority is cheaper.
- Fix (keep the sentence, uncontract):
  - `authLayout.dotsCanTLeadTrailOr` → "Dots cannot lead, trail or repeat."
  - `desktop.native.offlineTitle` → "Cannot reach Nexa" · `offline.canTConnect` → "Cannot connect" · `guestCall.canTJoinThisCall` → "Cannot join this call" · `login.canTReachTheServerCheck` → "Cannot reach the server. Check your connection and try again."
  - `imageActions.thisBrowserCanTCopyPictures` → "This browser cannot copy pictures. Save it instead." · `sounds.thisBrowserCanTPlaySounds` → "This browser cannot play sounds." · `voice.shareScreen.thisComputerCanTShareIts` → "This computer cannot share its sound."
  - `modals.createServer.thatDoesnTLookLikeAn` → "That does not look like an invite link or code."
  - `modals.customStatus.donTClear` → "Do not clear" · `server.memberAction.donTDeleteAny` → "Do not delete any"
  - `modals.invite.youDonTHoldThisServer` → "You do not hold this server's encryption key yet, so the link cannot carry it. New members will receive a key from a member who is online." · `server.encryption.youDonTHoldThisKey` → "You do not hold this key yet." · `server.encryption.everyMessageHereIsEndTo` → "… the server stores ciphertext and cannot read any of it."
  - `server.memberAction.thatDidnTWork` → "That did not work."
  - `settings.desktop.discordDoesnTSeemToBe` → "Discord does not seem to be running." · `settings.desktop.discordIsnTRunningActivityShows` → "Discord is not running: activity shows here, and will reach Discord too once it opens." · `settings.desktop.showWhatIMPlayingWatching` → "Show what I am playing, watching and listening to"
  - `settings.notifications.getANotificationForNewMessages` → "… when you are not looking at them, …" · `settings.security.canTScanIt` → "Cannot scan it?"
  - `sounds.soundProblem` → "The sound could not start{detail}. Tap the page and try again, and check that the volume is up." · `sounds.homeScreenSoundProblem` → "The sound could not start{detail}. … and {host} opened in Safari is not affected."
  - `voice.shareScreen.everyoneWatchingHearsWhatYouRe` → "Everyone watching hears what you are sharing. The call's own sound is left out." · `voice.shareScreen.everyoneWatchingHearsWhatYourComputer` → "… This version of Windows cannot leave the call itself out, …"
  - `server.serverOverview.shownOnInvitePagesSoPeople` → "Shown on invite pages so people know what they are joining."
  - `server.memberAction.confirmBan`, `sidebar.serverMenu.areYouSureYouWantToLeave`, `friends.*`, `chat.pins.*`, `settings.appearance.lookAtMeIMA` are rewritten in I18N-003/005/007 already.
- Effort: S
- Status: open

### I18N-015 · P3 · i18n · "user" where the app means a person
- Where: en
- Fix: `chat.groupMemberMenu.unknownUser`, `names.unknownUser` "Unknown User" → "Unknown person" (or "Deleted user" if that is what the state means — the fix agent should check `names.ts`); `chat.chat.userProfile`, `chat.chat.showUserProfile`, `chat.chat.hideUserProfile` → "Profile" / "Show profile" / "Hide profile"; `settings.account.editUserProfile` → "Edit profile"; `settings.settings.userSettings` → "Your settings"; `voice.voiceParticipants.userVolume` → "Their volume"; `friends.*` "that user"/"this user" are rewritten in I18N-007. Keep "User ID" (it is the field's name) and `settings.admin.users` (admin context).
- Effort: S
- Status: open

### I18N-016 · P3 · code · Twelve keys nothing asks for, three of them leftover sentence fragments
- Where: `tools/i18n_keys_used.py` output; all eleven locale files
- What: `activity.statusLine.moreCount`, `chat.messageList.forEveryoneAlreadyInItIt` (", for everyone already in it. …"), `chat.messageList.group` ("group."), `chat.messageList.messagesHereAreEndToEnd` (". Messages here …"), `composer.composer.dropToUploadTo`, `composer.gifsAndStickers`, `download.everyPhone`, `messageRow.originalMessage`, `messageRow.waitingForTheKeyToThis`, `pickers.pickers.recent`, `profile.profileCard.mutualFriend`, `settings.voice.theMicrophoneCouldNotBeOpened`. The three fragments are relics of a concatenation that was already replaced by `subchatStart`/`dmStart`; they were still translated ten times.
- Fix: delete the twelve keys from all eleven files (`tools/i18n_apply.py` or a ten-line script; never by hand in eleven files).
- Effort: S
- Status: open

### I18N-017 · P3 · parity · The empty-channel welcome differs between web and Android, and the group one is odd
- Where: web `MessageList.tsx:420-425` (`chat.messageList.welcomeToChannel` "Welcome to #{name}!" + `channelStart` "This is the start of the {name} channel." / `groupStart` "Welcome to the beginning of the {name} group." + `endToEnd`); Android `ChatScreen.kt:194-195` (`chatScreen.thisIsTheBeginningOf` "This is the beginning of #{name}" + `saySomethingToStartItOff` "Say something to start it off.")
- What: the same empty channel greets with different words on each platform; "Welcome to the beginning of the … group" is not something a person says.
- Fix: one heading and one line on both: heading "Welcome to #{name}" (channels) / the name (groups and DMs); line for channels "This is the start of #{name}. Say something to start it off." (`channelStart`), for groups "This is the start of {name}." (`groupStart`); Android uses the same two keys and drops `chatScreen.thisIsTheBeginningOf` / `saySomethingToStartItOff`. `endToEnd` stays appended on both.
- Effort: S
- Status: open

### I18N-018 · P2 · parity · The unsent-message state is "Message failed to send." on the web and "Not sent. Tap to try again." on Android
- Where: `web/src/components/chat/MessageItem.tsx:228` (`chat.messageItem.messageFailedToSend`), `android/.../ui/chat/MessageRow.kt:248` (`messageRow.notSentTapToTryAgain`)
- What: same state, two sentences; the web one is developer wording and sits next to a "Retry" button that already says what to do.
- Fix: web → "Not sent." (I18N-007); Android keeps "Not sent. Tap to try again." (it has no button). Both then start with the same words.
- Effort: S
- Status: open

### I18N-019 · P3 · ux · Jargon in user-facing sentences
- Where / fix:
  - `server.encryption.keyEpochCreatedBy` "Key epoch {epoch} · created {when} by {who}" → "Key version {epoch} · created {when} by {who}"
  - `auth.authScreen.yourRecoveryKeyUnwrapsYourAccount` "Your recovery key unwraps your account's keys." → "Your recovery key unlocks your account's keys."
  - `server.encryption.everyMessageHereIsEndTo` "… The server root key encrypts ordinary channels; private channels have keys of their own. Keys are only ever wrapped to members' devices; the server stores ciphertext and can't read any of it." → "… Ordinary channels share the server's key; private channels have keys of their own. Keys are only ever handed to members' devices; the server stores encrypted data and cannot read any of it."
  - `home.point.encryptedBody` "The server keeps ciphertext it cannot read, …" → "The server keeps encrypted data it cannot read, …"
  - `modals.shortcutsHelp.upEmptyComposer` "↑ (empty composer)" → "↑ (with the message box empty)"
  - `home.point.previewsTitle` "Link previews that do not out you" — "out you" is slang non-native readers and translators miss (checked in the locale pass) → "Link previews that do not give you away"
  - `lock.welcomeBackEnterYourPassword` "… Enter your password to decrypt your keys on this device." → "… Enter your password to unlock your keys on this device."
  - `callScreen.framesSealedOpened` "{sealed} sealed · {opened} opened" and `callScreen.framesDropped` "{dropped} dropped" (Android CallScreen.kt:236-239, a per-frame crypto counter shown to the caller) — either hide behind a diagnostics toggle or say "{sealed} sent · {opened} received · {dropped} lost".
- Effort: S
- Status: open

### I18N-020 · P3 · ux · Slow mode is spelled two ways in one element and its toast exists three times
- Where: `web/src/components/composer/Composer.tsx:539-540` (`composer.composer.slowModeIsEnabled` "Slow mode is enabled" as the title, `composer.composer.slowmodeIsEnabled` "Slowmode is enabled" as the text, and a hard-coded `${remaining}s`), `Composer.tsx:341` (`composer.composer.slowModeOnSeconds` "Slow mode is on. You can send again in {seconds}s."), `web/src/components/composer/send.ts:85` (`composer.send.slowModeTryAgain` "Slow mode is on. Try again in {seconds}s."), Android `composer.slowModeSeconds` "Slow mode: {seconds}s"
- Fix: one key `composer.composer.slowModeIsOn` "Slow mode is on" for both the title and the text; one toast `composer.send.slowModeTryAgain` "Slow mode is on. Try again in {seconds}s." for both call sites; delete `slowmodeIsEnabled`, `slowModeIsEnabled`, `slowModeOnSeconds`. The bare `${remaining}s` in the badge should go through `composer.slowModeSeconds`-style formatting so ja/zh can say "秒".
- Effort: S
- Status: open

### I18N-021 · P3 · parity · The friends screens say the same things in different words on web and Android
- Where: web `friends.*` vs Android `friends.friendsScreen.*`
- What: request sent → web "Success! Your friend request to {name} was sent." / Android "Request sent to @{username}."; empty list → web "No friends yet. Add someone with their username and start talking." / Android "Nobody here yet" + "Add someone by their username to get started."; accept → web `profile.profileCard.acceptFriendRequest` "Accept Friend Request" / Android "Accept friend request".
- Fix: one sentence each, both platforms on the same key: "Friend request sent to {name}." · "No friends yet. Add someone with their username and start talking." · "Accept friend request" (I18N-002 makes the last one identical; then drop the duplicate key).
- Effort: S
- Status: open

### I18N-022 · P3 · ux · Names are quoted with straight single quotes in eight strings and with “ ” in one; five dialog titles quote in code, untranslated
- Where: en `chat.groupMemberMenu.takeOwnershipOf`, `transferOwnershipOf`, `theyAreRemovedFromTheGroup`, `packRemoval.removePackNamed`, `server.channelSettings.deleteCategoryHint`, `server.packEditor.deleteNamed`, `sidebar.dmMenu.deleteNamed`, `sidebar.serverMenu.deleteTheCategoryNamed`, `sidebar.serverMenu.leaveNamed` ('{name}'), `server.deleteServer.typeToConfirm`, `settings.admin.configSays` ("{value}"), `friends.nobodyHereMatches` (“{query}”); code titles `` `Leave '${name}'` `` in `dmMenu.ts:128`, `groupMemberMenu.ts:100`, `` `Delete '${…}'` `` in `SubchatPanel.tsx:39`, `PackEditor.tsx:192`, `RolesPage.tsx:244`, `` `Delete @${u.username}` `` `AdminPage.tsx:158`, `` `Delete :${e.name}:` `` `EmojiPage.tsx:87`
- What: three quote styles for the same job; the code-side titles are English in every language ([web-chat-ui]/[web-shell-ui] for the code).
- Fix: en uses “{name}” everywhere (each locale its own: de „{name}“, fr « {name} », ja 「{name}」, ru «{name}», zh-CN “{name}”); the five code titles use the existing keys `sidebar.serverMenu.leaveNamed`, `sidebar.dmMenu.deleteNamed`, `server.packEditor.deleteNamed`.
- Effort: S
- Status: open

### I18N-023 · P3 · ux · "Click" on phones and "Tap" on desktops
- Where: en `chat.messageItem.clickToSeeAttachment`, `profile.profileCard.clickToAddANote`, `server.emoji.dropImagesHere` ("… or click to upload …"), `toasts.dismiss` "Tap to dismiss" (a screen-reader hint on the desktop web too), `sounds.soundProblem` "Tap the page and try again"
- Fix: device-neutral: "Attachment" (I18N-005) · "Add a note" · "Drop images here or choose files (PNG, GIF, WebP, JPEG; 2 MB each; 512×512 or smaller works best)." · "Dismiss" · "Select the page and try again". `settings.voice.clickTheBoxThenPressThe` and `settings.appearance.underlinesMisspelledWords…` ("Right-click") are keyboard/desktop-only and fine.
- Effort: S
- Status: open

### I18N-024 · P3 · ux · "End to end encrypted chat" is unhyphenated where it is an adjective
- Where: en `desktop.native.about` "End to end encrypted chat, voice and servers." (the About box), `home.foot.tagline` "Nexa. End to end encrypted chat, voice and servers."; `web/index.html` and the manifest say "end-to-end encrypted chat".
- Fix: "End-to-end encrypted chat, voice and servers." in both keys (adverbial uses such as "Messages encrypted end to end" are correct as they are).
- Effort: S
- Status: open

### I18N-025 · P3 · code · The voice diagnostics report translates five fragments inside an English dump
- Where: `web/src/voice/media.ts:296-320`; en `media.theOneYouPicked`, `media.foundAgainByName`, `media.notAvailableThisIsTheSystem` ("NOT AVAILABLE — this is the system default instead"), `media.systemDefault`, `media.sentStraightThrough`, `media.throughTheSlider`
- What: `describeInput` builds "device: …", "track: …", "input volume: 80% (sent straight through)" for a bug report; the labels are English, the parenthetical is translated. In ja the line reads "input volume: 80% (そのまま送信)".
- Fix: it is a developer-facing report — keep the whole thing in English and delete the six `media.*` keys from all eleven files; or, if it is shown in the UI, translate the labels too.
- Effort: S
- Status: open

### I18N-026 · P3 · ux · "You're already in — Open" as a button label
- Where: en `invite.youReAlreadyInOpen`, `web/src/pages/InvitePage.tsx:163`
- What: a status and an action in one button; awkward, and in RTL the dash reads the other way.
- Fix: button "Open" (`chat.lockedChannel.open`), with a line above it "You are already in {name}." (`invite.youAreAlreadyIn`).
- Effort: S
- Status: open

### I18N-027 · P3 · i18n · Kaomoji live inside translatable sentences
- Where: en `composer.commands.appendsToYourMessage` "Appends (╯°□°)╯︵ ┻━┻ to your message.", `…2` "Appends ┬─┬ ノ( ゜-゜ノ) …", `…3` "Appends ( ͡° ͜ʖ ͡°) …"
- What: the art is data, not prose; a translator (or a model) can mangle it, and it is repeated in ten files. The locale pass checks whether it survived.
- Fix: one key `composer.commands.appendsToYourMessage` "Appends {what} to your message." with the kaomoji passed as a value.
- Effort: S
- Status: open

### I18N-028 · P2 · a11y · [web-shell-ui] The viewport meta forbids pinch zoom
- Where: `web/index.html:5` `user-scalable=no, maximum-scale=1`
- What: WCAG 1.4.4; Android Chrome honours it, so low-vision users cannot zoom the web app on a phone (iOS ignores it). If it exists to stop double-tap zoom, `touch-action: manipulation` on the body does that without blocking pinch.
- Effort: S
- Status: open

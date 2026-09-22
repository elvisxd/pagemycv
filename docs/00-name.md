# The name

**Current placeholder: `Nibble`.** Nothing is committed. Pick one and the whole
repository follows with a single command.

## Shortlist

| Name | The idea | For | Against |
|---|---|---|---|
| **Nibble** ★ | A nibble is half a byte. Byte is the agent, Nibble is the small browser companion. | Short, says bot, and pairs with Byte into a story a recruiter remembers. Easy to say in an interview. | Does not describe what it does. Needs one sentence of explanation. |
| **PageMyCV** | Your own instinct. It pages your CV into the form. | Nobody has to ask what it does. | Four syllables, awkward to say, reads like a 2011 web app. Hard to turn into a mark. |
| **Understudy** | The actor who stands in for you and never takes the stage. | Conceptually exact: it prepares, you perform. Memorable and unusual. | Long. Ten letters and three syllables in a side panel header. |
| **Carbon** | A carbon copy of your CV, pressed into a form. | Elegant, one word, good mark. Ties to paper without being twee. | Heavily used. Collides with a design system and a blockchain project. |
| **Clip** | The paperclip that attaches your CV. | Shortest option. Obvious icon. | Generic. Faint echo of Clippy, which cuts both ways. |
| **Stub** | In code, a stub stands in where the real thing goes. | Developer audience gets it instantly. | Connotation of incomplete. A recruiter reads it as unfinished. |

★ My recommendation. The Byte and Nibble pairing gives you two repositories that
obviously belong to the same mind, which is worth more on a portfolio than a
name that self-describes.

## Not checked

I could not verify availability of any of these on npm, the Chrome Web Store or
as a domain from this environment. Check before you commit to a mark:

- Chrome Web Store: search the name, extensions do not need a unique name but a
  collision hurts you
- npm: only matters if you ever publish a package
- Domain: `.dev` or `.app` if you want a privacy-policy page, which the Chrome
  Web Store requires if you ever publish

## Renaming

Everything in this repository refers to the name in exactly one form. To change it:

```bash
# from the repository root
OLD=Nibble NEW=Understudy
grep -rl "$OLD" --exclude-dir=.git . | xargs sed -i '' "s/$OLD/$NEW/g"       # macOS
grep -rl "$OLD" --exclude-dir=.git . | xargs sed -i    "s/$OLD/$NEW/g"       # Linux

# lowercase form, for package names and folders
grep -rl "nibble" --exclude-dir=.git . | xargs sed -i '' "s/nibble/understudy/g"
```

Then rename the repository on GitHub under Settings. Old links keep redirecting,
so nothing breaks.

## Decision

- [ ] Name chosen: ______________
- [ ] Repository renamed on GitHub
- [ ] Availability checked

# Vision

## One sentence

A browser bot that types your own CV into a job application form, keeps every
byte of it on your machine, and stops before submit.

## The problem, stated honestly

Applying is a typing job. The same forty fields, the same six free-text
questions, thirty times a week. The tools that solve it all made the same
trade: they hold your résumé on their servers so it can follow you between
devices.

That trade is worse than it looks. A job application is not a profile. It
carries your home address, your phone number, your full employment history and,
increasingly, your work authorization status and demographic data. Concentrated
in one vendor's database, that is a dossier on a person who is between jobs,
which is precisely when a person can least afford an incident.

## What we are actually building

The browser half of a system whose other half already exists.

[Byte](https://github.com/elvisxd/byte) already has `empleo/`, which pulls
postings from official feeds, scores them against `perfil/busqueda.toml`, tracks
what happened to each application by reading your own inbox, and flags scam
patterns. It already has `perfil/cv.md` as the single source of truth for the CV.

What Byte deliberately does not do is apply. From its own module docstring:

> Nada de acá postula por vos. Junta links, los ordena por qué tan cerca están
> de tu perfil y te los manda; abrir el link y aplicar es tuyo.

PageMyCV does not change that stance. It removes the typing, not the decision.

## Who it is for

One person: you. If it ever gets published, the second user is someone with the
same problem and the same discomfort about where their CV lives. It is not a
product with a funnel. Designing it as if it were would push it toward the cloud
profile that every incumbent already built.

## The four refusals

These are the product. Everything else is implementation.

### 1. It never submits

Not as a setting. The bulk submitters are a different category of tool with a
different legal posture and visibly worse outcomes: CAPTCHA walls, banned
accounts, one-star reviews. More importantly, a form you did not read is an
application you cannot defend in the interview.

### 2. Sensitive fields always ask

Your own private profile notes already state the rule, about work authorization
expiry:

> Si un formulario lo pide como campo obligatorio, eso es una decisión que la
> toma él, no Byte: preguntale antes de completar nada.

That generalises into a field class. Visa status and dates, document numbers,
salary expectation, and the voluntary demographic questions never fill
automatically. They surface, one by one, with the value on offer and a reason
why it is being asked.

### 3. The page never decides

A job posting is text written by someone else. It can be read for values. It can
never be read for instructions. That boundary is also what keeps the extension
inside Chrome's remote-code rules.

### 4. Nothing leaves the machine except what you send

No telemetry. No analytics. No crash reporting. The only outbound request is to
your own Byte instance, and only for free-text answers.

## What success looks like

Not installs. Three things:

| | |
|---|---|
| A Lever or Greenhouse application filled, reviewed and submitted in under 90 seconds | The core claim works |
| Zero sensitive fields ever filled without an explicit tap | The refusal holds under real use |
| A Workday application completed without the honeypot being touched | The hard case is solved |

## Non-goals

- Bulk or unattended application
- LinkedIn Easy Apply and Indeed Apply, which prohibit automating activity on
  their sites
- A cloud profile, cross-device sync, or an account system
- Job search, scoring or tracking, which already live in Byte and do not belong
  in a browser extension

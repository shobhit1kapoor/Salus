# Protected data-flow inventory

| Flow | Raw input exists only in | First protection | Durable form | External AI form | Reveal rule |
|---|---|---|---|---|---|
| account/profile | request memory | discovery + Protegrity-wrapped trace key | pseudonym/fingerprint + AES-GCM canonical envelope | never sent | recent MFA for identifiers |
| care note/timeline | request memory | protect | AI-safe fact + protected summary | purpose-minimized fact | routine in scope |
| medication/lab | request memory | protect structured value | AI-safe clinical view + envelope | relevant pseudonymized clinical fact | purpose and scope |
| document | upload/extraction memory | object key wrap; extracted-text protect | AES-GCM bytes + protected text + safe chunks | selected safe chunks | MFA for original |
| voice | encrypted local object/manual input memory | object key wrap; transcript protect | encrypted audio + safe/protected transcript | never raw audio | reviewed transcript only |
| assistant | request memory | input protect + guardrail; complete prompt protect + rescan | protected prompt/response + safe views | minimum-necessary protected context with ephemeral source aliases | output release policy |
| tool call | no raw input | signed capability | protected result metadata | minimum safe result | scope and expiry |
| notification | Privacy Gateway for address reveal | stored address envelope | generic delivery metadata | none | generic text only |
| FHIR import/export | request or reveal memory | full bundle protect | protected exchange + safe resources | none by default | export scope + purpose + MFA + no-store |
| audit/evidence | no raw values permitted | metadata construction | hashes, counts, decisions | none | member-visible proof |

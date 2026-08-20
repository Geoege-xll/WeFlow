/**
 * 此文件由 shared/omnimind-automatic-hosting-policy.json 生成。
 * 请勿在 OmniMindWeChat（WeFlow 二开）或 QQ 子项目内单独修改；统一运行：
 * node scripts/sync-omnimind-automatic-hosting-policy.mjs --write
 */
export const UNIFIED_AUTOMATIC_HOSTING_POLICY = Object.freeze({
  "schemaVersion": 1,
  "autoSend": true,
  "batchWindowMs": {
    "default": 2000,
    "min": 500,
    "max": 10000,
    "step": 500
  },
  "postReplyDelaySeconds": {
    "default": 0,
    "allowed": [
      0,
      3,
      5
    ]
  },
  "openChat": {
    "responseMode": "sync",
    "transportGuardMs": 330000,
    "maxActorsPerBatch": 50,
    "maxMessagesPerBatch": 50,
    "maxContentPartsPerMessage": 8,
    "maxTextCharsPerPart": 8000,
    "minExtensionsBytes": 2,
    "minExtensionDepth": 1,
    "minIdempotencyKeyLength": 71
  }
} as const)

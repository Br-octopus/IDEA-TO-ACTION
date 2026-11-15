import type {} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'forward-step/capability-unverified': {},
    'forward-step/capability-unavailable': {}
  }
}

export {}

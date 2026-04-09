export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  metadata?: any
}

export interface StreamEvent {
  type: 'assistant' | 'tool_use' | 'tool_result' | 'usage' | 'error' | 'done'
  content?: string
  streaming?: boolean
  tool_name?: string
  input_tokens?: number
  output_tokens?: number
  error?: string
}

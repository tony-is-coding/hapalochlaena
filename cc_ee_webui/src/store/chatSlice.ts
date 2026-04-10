import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { Message } from '../types/message'

interface ChatState {
  messages: Message[]
  isStreaming: boolean
  currentSessionId: string | null
}

const initialState: ChatState = {
  messages: [],
  isStreaming: false,
  currentSessionId: null,
}

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    addMessage: (state, action: PayloadAction<Message>) => {
      state.messages.push(action.payload)
    },
    setMessages: (state, action: PayloadAction<Message[]>) => {
      state.messages = action.payload
    },
    setStreaming: (state, action: PayloadAction<boolean>) => {
      state.isStreaming = action.payload
    },
    setCurrentSession: (state, action: PayloadAction<string>) => {
      state.currentSessionId = action.payload
    },
    clearMessages: (state) => {
      state.messages = []
    },
  },
})

export const { addMessage, setMessages, setStreaming, setCurrentSession, clearMessages } = chatSlice.actions
export default chatSlice.reducer

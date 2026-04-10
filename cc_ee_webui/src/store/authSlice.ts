import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { User } from '../types/auth'

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
}

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    login: (state, action: PayloadAction<{ user: User; token: string }>) => {
      state.user = action.payload.user
      state.token = action.payload.token
      state.isAuthenticated = true
      state.isLoading = false
    },
    logout: (state) => {
      state.user = null
      state.token = null
      state.isAuthenticated = false
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload
    },
  },
})

export const { login, logout, setLoading } = authSlice.actions
export default authSlice.reducer

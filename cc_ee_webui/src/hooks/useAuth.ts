import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { RootState } from '../store'
import { login, logout, setLoading } from '../store/authSlice'
import { authService } from '../services/auth.service'

export function useAuth() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { user, token, isAuthenticated, isLoading } = useSelector(
    (state: RootState) => state.auth
  )

  useEffect(() => {
    const savedToken = localStorage.getItem('token')
    if (savedToken) {
      dispatch(setLoading(false))
    } else {
      dispatch(setLoading(false))
    }
  }, [dispatch])

  const handleLogin = async (email: string, password: string) => {
    const response = await authService.login(email, password)
    dispatch(login(response))
    localStorage.setItem('token', response.token)
    navigate('/')
  }

  const handleLogout = () => {
    dispatch(logout())
    localStorage.removeItem('token')
    navigate('/login')
  }

  return { user, token, isAuthenticated, isLoading, login: handleLogin, logout: handleLogout }
}

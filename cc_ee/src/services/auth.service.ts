import bcrypt from 'bcrypt'
import { userRepo } from '../repositories/user.repo'
import { User } from '../models/user'

class AuthService {
  async validateUser(email: string, password: string): Promise<User | null> {
    const user = await userRepo.findByEmail(email)
    if (!user) return null
    const valid = await bcrypt.compare(password, user.passwordHash)
    return valid ? user : null
  }
}

export const authService = new AuthService()

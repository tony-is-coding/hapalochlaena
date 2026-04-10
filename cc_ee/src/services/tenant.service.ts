import { tenantRepo } from '../repositories/tenant.repo'
import { Tenant, CreateTenantInput } from '../models/tenant'

class TenantService {
  async getTenant(tenantId: string): Promise<Tenant | null> {
    return tenantRepo.findById(tenantId)
  }

  async createTenant(input: CreateTenantInput): Promise<Tenant> {
    return tenantRepo.create(input)
  }

  async listTenants(): Promise<Tenant[]> {
    return tenantRepo.findAll()
  }
}

export const tenantService = new TenantService()

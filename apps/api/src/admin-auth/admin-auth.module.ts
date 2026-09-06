import { Module } from '@nestjs/common';

import { AdminAuthController } from './admin-auth.controller';
import { AdminAccountSecurityController } from './admin-account-security.controller';
import { AdminLoginRateLimiter } from './admin-login-rate-limiter';
import { AdminAuthService } from './admin-auth.service';

@Module({ controllers: [AdminAuthController, AdminAccountSecurityController], providers: [AdminAuthService, AdminLoginRateLimiter] })
export class AdminAuthModule {}

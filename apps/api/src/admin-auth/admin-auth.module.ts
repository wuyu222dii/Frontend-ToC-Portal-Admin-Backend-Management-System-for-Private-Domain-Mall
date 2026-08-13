import { Module } from '@nestjs/common';

import { AdminAuthController } from './admin-auth.controller';
import { AdminLoginRateLimiter } from './admin-login-rate-limiter';
import { AdminAuthService } from './admin-auth.service';

@Module({ controllers: [AdminAuthController], providers: [AdminAuthService, AdminLoginRateLimiter] })
export class AdminAuthModule {}

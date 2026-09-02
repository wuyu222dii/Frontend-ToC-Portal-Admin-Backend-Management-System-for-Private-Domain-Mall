import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query } from '@nestjs/common';

import { Public } from '../platform/access/rbac.metadata';
import { AgentRealm, AllowRestrictedAgentSession } from '../platform/auth/agent-realm.metadata';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import {
  assertNoAgentAuthBody,
  assertNoAgentAuthQuery,
  parseAgentChangePasswordBody,
  parseAgentLoginBody,
  parseAgentRefreshBody,
} from './agent-auth.dto';
import {
  AgentAuthRequest,
  agentRequestIp,
  requireAgentRequestId,
  requireAgentSession,
  requireTemporaryAgentSession,
  requireUnrestrictedAgentSession,
  type AgentAuthRequestContext,
} from './agent-auth.request';
import { AgentAuthService } from './agent-auth.service';

@Controller('agent/auth')
export class AgentAuthController {
  constructor(@Inject(AgentAuthService) private readonly auth: AgentAuthService) {}

  @Post('login') @HttpCode(HttpStatus.OK) @Public() @NoStore()
  login(@Body() body: unknown, @Query() query: unknown, @IdempotencyKey() key: string,
    @AgentAuthRequest() request: AgentAuthRequestContext) {
    assertNoAgentAuthQuery(query);
    return this.auth.login(parseAgentLoginBody(body), key, requireAgentRequestId(request), agentRequestIp(request));
  }

  @Post('refresh') @HttpCode(HttpStatus.OK) @Public() @NoStore()
  refresh(@Body() body: unknown, @Query() query: unknown, @IdempotencyKey() key: string,
    @AgentAuthRequest() request: AgentAuthRequestContext) {
    assertNoAgentAuthQuery(query);
    return this.auth.refresh(parseAgentRefreshBody(body), key, requireAgentRequestId(request), agentRequestIp(request));
  }

  @Post('logout') @HttpCode(HttpStatus.OK) @AgentRealm() @AllowRestrictedAgentSession() @NoStore()
  logout(@Body() body: unknown, @Query() query: unknown, @IdempotencyKey() key: string,
    @AgentAuthRequest() request: AgentAuthRequestContext) {
    assertNoAgentAuthBody(body);
    assertNoAgentAuthQuery(query);
    return this.auth.logout(requireAgentSession(request), key, requireAgentRequestId(request), agentRequestIp(request));
  }

  @Post('change-temporary-password') @HttpCode(HttpStatus.OK) @AgentRealm() @AllowRestrictedAgentSession() @NoStore()
  changeTemporaryPassword(@Body() body: unknown, @IdempotencyKey() key: string,
    @Query() query: unknown, @AgentAuthRequest() request: AgentAuthRequestContext) {
    assertNoAgentAuthQuery(query);
    return this.auth.changeTemporaryPassword(
      requireTemporaryAgentSession(request),
      parseAgentChangePasswordBody(body),
      key,
      requireAgentRequestId(request),
      agentRequestIp(request),
    );
  }

  @Post('change-password') @HttpCode(HttpStatus.OK) @AgentRealm() @NoStore()
  changePassword(@Body() body: unknown, @IdempotencyKey() key: string,
    @Query() query: unknown, @AgentAuthRequest() request: AgentAuthRequestContext) {
    assertNoAgentAuthQuery(query);
    return this.auth.changePassword(
      requireUnrestrictedAgentSession(request),
      parseAgentChangePasswordBody(body),
      key,
      requireAgentRequestId(request),
      agentRequestIp(request),
    );
  }

  @Post('logout-all') @HttpCode(HttpStatus.OK) @AgentRealm() @NoStore()
  logoutAll(@Body() body: unknown, @Query() query: unknown, @IdempotencyKey() key: string,
    @AgentAuthRequest() request: AgentAuthRequestContext) {
    assertNoAgentAuthBody(body);
    assertNoAgentAuthQuery(query);
    return this.auth.logoutAll(
      requireUnrestrictedAgentSession(request),
      key,
      requireAgentRequestId(request),
      agentRequestIp(request),
    );
  }

  @Get('current') @AgentRealm() @NoStore()
  current(@Body() body: unknown, @Query() query: unknown, @AgentAuthRequest() request: AgentAuthRequestContext) {
    assertNoAgentAuthBody(body);
    assertNoAgentAuthQuery(query);
    return this.auth.current(requireUnrestrictedAgentSession(request));
  }
}

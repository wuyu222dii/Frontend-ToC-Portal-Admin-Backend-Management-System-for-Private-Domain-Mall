import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { RequireRoles } from '../platform/access/rbac.metadata';
import type { PrincipalRequest } from '../platform/access/principal';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import {
  parseAdminAgentCreateBody,
  parseAdminAgentEmptyBody,
  parseAdminAgentEmptyQuery,
  parseAdminAgentId,
  parseAdminAgentListQuery,
  parseAdminAgentUpdateBody,
  parseAgentStatusActionBody,
  parseAgentStatusConfirmationBody,
  parseInviteRotationActionBody,
  parseInviteRotationConfirmationBody,
  parseInviteStatusActionBody,
  parseInviteStatusConfirmationBody,
  parseProductAuthorizationBody,
  parseReasonActionBody,
  parseReasonConfirmationBody,
} from './admin-agents.dto';
import { requireAdminAgentRequest } from './admin-agents.request';
import { AdminAgentsService } from './admin-agents.service';

@Controller('admin/agents')
@RequireRoles('SUPER_ADMIN')
export class AdminAgentsController {
  constructor(@Inject(AdminAgentsService) private readonly agents: AdminAgentsService) {}

  @Get()
  list(@Query() query: unknown) {
    return this.agents.list(parseAdminAgentListQuery(query));
  }

  @Post() @HttpCode(HttpStatus.CREATED) @NoStore()
  create(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminAgentEmptyQuery(query);
    return this.agents.create(
      requireAdminAgentRequest(request),
      parseAdminAgentCreateBody(body),
      key,
    );
  }

  @Get(':agent_id')
  detail(@Param('agent_id') agentId: string, @Query() query: unknown) {
    parseAdminAgentEmptyQuery(query);
    return this.agents.detail(parseAdminAgentId(agentId));
  }

  @Get(':agent_id/product-authorization')
  productAuthorization(@Param('agent_id') agentId: string, @Query() query: unknown) {
    parseAdminAgentEmptyQuery(query);
    return this.agents.productAuthorization(parseAdminAgentId(agentId));
  }

  @Patch(':agent_id/product-authorization')
  updateProductAuthorization(
    @Param('agent_id') agentId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminAgentEmptyQuery(query);
    return this.agents.updateProductAuthorization(
      requireAdminAgentRequest(request),
      parseAdminAgentId(agentId),
      parseProductAuthorizationBody(body),
      expectedVersion,
      key,
    );
  }

  @Patch(':agent_id')
  update(
    @Param('agent_id') agentId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminAgentEmptyQuery(query);
    return this.agents.update(
      requireAdminAgentRequest(request),
      parseAdminAgentId(agentId),
      parseAdminAgentUpdateBody(body),
      expectedVersion,
      key,
    );
  }

  @Post(':agent_id/status-change-preview') @HttpCode(HttpStatus.OK) @NoStore()
  previewDisable(
    @Param('agent_id') agentId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminAgentEmptyQuery(query);
    return this.agents.previewDisable(
      requireAdminAgentRequest(request),
      parseAdminAgentId(agentId),
      parseAgentStatusActionBody(body),
      key,
    );
  }

  @Post(':agent_id/status-changes') @HttpCode(HttpStatus.OK) @NoStore()
  disable(
    @Param('agent_id') agentId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminAgentEmptyQuery(query);
    return this.agents.disable(
      requireAdminAgentRequest(request),
      parseAdminAgentId(agentId),
      parseAgentStatusConfirmationBody(body),
      expectedVersion,
      key,
    );
  }

  @Post(':agent_id/reactivate') @HttpCode(HttpStatus.OK)
  reactivate(
    @Param('agent_id') agentId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminAgentEmptyBody(body);
    parseAdminAgentEmptyQuery(query);
    return this.agents.reactivate(
      requireAdminAgentRequest(request),
      parseAdminAgentId(agentId),
      expectedVersion,
      key,
    );
  }

  @Post(':agent_id/password-reset-preview') @HttpCode(HttpStatus.OK) @NoStore()
  previewPasswordReset(
    @Param('agent_id') agentId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminAgentEmptyQuery(query);
    return this.agents.previewPasswordReset(
      requireAdminAgentRequest(request),
      parseAdminAgentId(agentId),
      parseReasonActionBody(body),
      key,
    );
  }

  @Post(':agent_id/password-resets') @HttpCode(HttpStatus.OK) @NoStore()
  resetPassword(
    @Param('agent_id') agentId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminAgentEmptyQuery(query);
    return this.agents.resetPassword(
      requireAdminAgentRequest(request),
      parseAdminAgentId(agentId),
      parseReasonConfirmationBody(body),
      expectedVersion,
      key,
    );
  }

  @Post(':agent_id/invite-code/rotate-preview') @HttpCode(HttpStatus.OK) @NoStore()
  previewInviteCodeRotation(
    @Param('agent_id') agentId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminAgentEmptyQuery(query);
    return this.agents.previewInviteCodeRotation(
      requireAdminAgentRequest(request),
      parseAdminAgentId(agentId),
      parseInviteRotationActionBody(body),
      key,
    );
  }

  @Post(':agent_id/invite-code/rotate') @HttpCode(HttpStatus.OK) @NoStore()
  rotateInviteCode(
    @Param('agent_id') agentId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminAgentEmptyQuery(query);
    return this.agents.rotateInviteCode(
      requireAdminAgentRequest(request),
      parseAdminAgentId(agentId),
      parseInviteRotationConfirmationBody(body),
      expectedVersion,
      key,
    );
  }

  @Post(':agent_id/invite-code/status-preview') @HttpCode(HttpStatus.OK) @NoStore()
  previewInviteCodeStatus(
    @Param('agent_id') agentId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminAgentEmptyQuery(query);
    return this.agents.previewInviteCodeStatus(
      requireAdminAgentRequest(request),
      parseAdminAgentId(agentId),
      parseInviteStatusActionBody(body),
      key,
    );
  }

  @Patch(':agent_id/invite-code')
  updateInviteCodeStatus(
    @Param('agent_id') agentId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminAgentEmptyQuery(query);
    return this.agents.updateInviteCodeStatus(
      requireAdminAgentRequest(request),
      parseAdminAgentId(agentId),
      parseInviteStatusConfirmationBody(body),
      expectedVersion,
      key,
    );
  }
}

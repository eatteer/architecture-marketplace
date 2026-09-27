// A controller route: read the request, build the command, call one use case, shape the response —
// with the documentation, the security schemes and the permission it takes to reach it.

import { Body, Controller, HttpStatus, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";

import { actorFrom } from "@/common/presentation/actor-from";
import { dataResponse } from "@/common/presentation/api-response";
import type { DataResponse } from "@/common/presentation/api-response";
import { ApiDataResponse, ApiProblemResponse } from "@/common/presentation/decorators/api-envelope.decorator";
import { CurrentUser } from "@/common/presentation/decorators/current-user.decorator";
import { CreatedDto } from "@/common/presentation/dtos/created.dto";
import type { Principal } from "@/common/presentation/principal";
import { BEARER_SECURITY_SCHEME, COOKIE_SECURITY_SCHEME } from "@/common/presentation/security-schemes";
import { RequirePermissions } from "@/features/authorization/presentation/decorators/require-permissions.decorator";
import { CreateUserCommand } from "@/features/users/application/commands/create-user.command";
import { CreateUserUseCase } from "@/features/users/application/use-cases/create-user.usecase";
import { CreateUserDto } from "@/features/users/presentation/dtos/create-user.dto";

@ApiTags("Users")
@ApiBearerAuth(BEARER_SECURITY_SCHEME)
@ApiCookieAuth(COOKIE_SECURITY_SCHEME)
@ApiProblemResponse(HttpStatus.UNAUTHORIZED, "No valid credentials were presented")
@ApiProblemResponse(HttpStatus.FORBIDDEN, "Missing the required permission")
@Controller("users")
export class UsersController {
  public constructor(private readonly _createUser: CreateUserUseCase) {}

  @ApiOperation({ summary: "Create a user", description: "Requires the `users:create` permission." })
  @ApiDataResponse(CreatedDto, { status: HttpStatus.CREATED, description: "User created" })
  @ApiProblemResponse(HttpStatus.BAD_REQUEST, "The body is not valid")
  @ApiProblemResponse(HttpStatus.CONFLICT, "The email is already registered")
  @RequirePermissions("users:create")
  @Post()
  public async createUser(
    @Body() dto: CreateUserDto,
    @CurrentUser() principal: Principal,
  ): Promise<DataResponse<CreatedDto>> {
    const userId = await this._createUser.execute(
      new CreateUserCommand({
        email: dto.email,
        name: dto.name,
        performedBy: actorFrom(principal),
      }),
    );

    return dataResponse({ id: userId });
  }
}

import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

import { API_TAGS } from '../app.constants';
import { ErrorResponseDto } from '../common/dto/error-response.dto';
import { ListMembersQueryDto } from './dto/list-members.query.dto';
import { MemberListResponseDto, MemberProfileResponseDto } from './dto/member.dto';
import { MembersService } from './members.service';

@ApiTags(API_TAGS.members)
@Controller('members')
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  @ApiOperation({
    summary: 'Members, filtered and ordered by churn risk',
    description:
      'Every row carries the deterministic churn score, so this endpoint is a retention worklist rather than a directory. `riskBand` matches at or above the band given, which is why one parameter produces the list a membership director actually wants.',
  })
  @ApiOkResponse({ type: MemberListResponseDto })
  list(@Query() query: ListMembersQueryDto): MemberListResponseDto {
    return this.members.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Member 360: profile, churn assessment and recent activity',
    description:
      'The churn score arrives with every contributing signal and its point value. That decomposition is the point: a score that drives a phone call from the GM has to be explainable to the member on the other end of it, and no language model is involved in producing it.',
  })
  @ApiParam({ name: 'id', example: 'm-0001', description: 'Internal member id (not the member number).' })
  @ApiOkResponse({ type: MemberProfileResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'No member with that id exists in this dataset.' })
  profile(@Param('id') id: string): MemberProfileResponseDto {
    return this.members.profile(id);
  }
}

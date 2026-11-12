import { Injectable } from '@nestjs/common';
import { AUTHORIZATION_RESOURCES } from '../domain/authorization-resources.js';

@Injectable()
export class ListAuthorizationResources {
  execute() {
    return AUTHORIZATION_RESOURCES.map((resource) => ({ ...resource }));
  }
}

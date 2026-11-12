import { Injectable } from '@nestjs/common';
import { isEmail } from 'class-validator';
import type { ContactEmailValidator } from '../application/ports/contact-email-validator.js';

@Injectable()
export class ContactEmailValidatorAdapter implements ContactEmailValidator {
  isValid(value: string): boolean {
    return isEmail(value);
  }
}

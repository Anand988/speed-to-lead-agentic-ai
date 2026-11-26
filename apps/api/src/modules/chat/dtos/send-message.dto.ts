import {
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { MAX_CHAT_MESSAGE_LENGTH } from '../chat-guard.types.js';

// Rejects ASCII control characters (\x00-\x08, \x0B, \x0C, \x0E-\x1F, \x7F)
const NO_CONTROL_CHARS_REGEX = /^[^\x00-\x08\x0B\x0C\x0E-\x1F\x7F]*$/;

export class SendMessageDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: 'Message cannot be empty.' })
  @MaxLength(MAX_CHAT_MESSAGE_LENGTH, {
    message: `Message cannot exceed ${MAX_CHAT_MESSAGE_LENGTH} characters.`,
  })
  @Matches(NO_CONTROL_CHARS_REGEX, {
    message: 'Invalid control characters detected in message.',
  })
  message: string;

  @IsOptional()
  @IsString()
  visitorSessionToken?: string;
}
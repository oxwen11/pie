import type { SessionUIMessage } from "@getpie/contract";
import { CollapsibleUserText } from "@getpie/ui/ai-elements/collapsible-user-text";
import { Message, MessageContent } from "@getpie/ui/ai-elements/message";

export function UserMessage({ message }: { message: SessionUIMessage }) {
  return (
    <>
      {message.parts.map((part, index) =>
        part.type === "text" ? (
          // A user message is built once at submit time and never streamed, so
          // `parts` is a frozen array that cannot reorder or filter. Text parts
          // carry no id of their own, which leaves the position as the only key.
          // react-doctor-disable-next-line no-array-index-as-key
          <Message key={index} from="user">
            <MessageContent>
              <CollapsibleUserText text={part.text} />
            </MessageContent>
          </Message>
        ) : null,
      )}
    </>
  );
}

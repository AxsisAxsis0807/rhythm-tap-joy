import { useState } from "react";
import { CircleUserRound } from "lucide-react";

type Props = {
  src?: string | null | undefined;
  imageClassName: string;
  fallbackClassName: string;
};

function AvatarSource({ src, imageClassName, fallbackClassName }: Props) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img src={src} alt="" className={imageClassName} onError={() => setFailed(true)} />
  ) : (
    <CircleUserRound aria-hidden="true" className={fallbackClassName} />
  );
}

export function PlayerAvatar(props: Props) {
  return <AvatarSource key={props.src ?? ""} {...props} />;
}

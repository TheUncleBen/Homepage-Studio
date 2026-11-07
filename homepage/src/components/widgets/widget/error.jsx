import { useTranslation } from "next-i18next/pages";
import { useContext } from "react";
import { BiError } from "react-icons/bi";

import Container from "./container";
import PrimaryText from "./primary_text";
import WidgetIcon from "./widget_icon";

import CardError from "components/studio/card-error";
import { CardLookContext } from "components/studio/card-look";

// error: what the widget's request failed with. Inside a Studio card it is
// named in a sentence, like an integration's card, with the Fix link for
// people who can edit the widget (UI review M3, 7 Nov 2026).
export default function Error({ options, error }) {
  const { t } = useTranslation();
  const card = useContext(CardLookContext);
  if (card && error) return <CardError card={card} service={{ name: card.title }} error={error} compact />;

  return (
    <Container options={options} additionalClassNames="information-widget-error">
      <PrimaryText>{t("widget.api_error")}</PrimaryText>
      <WidgetIcon icon={BiError} size="l" />
    </Container>
  );
}

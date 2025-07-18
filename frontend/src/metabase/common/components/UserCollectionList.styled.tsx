// eslint-disable-next-line no-restricted-imports
import styled from "@emotion/styled";

import { GridItem } from "metabase/common/components/Grid";

export const ListHeader = styled.div`
  padding: 1rem 0;
`;

export const ListGridItem = styled(GridItem)`
  width: 33.33%;

  &:hover {
    color: var(--mb-color-brand);
  }
`;

export const CardContent = styled.div`
  display: flex;
  align-items: center;
`;

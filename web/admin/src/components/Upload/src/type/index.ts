/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
export interface BasicProps {
  title?: string;
  dataSource: (...args: any[]) => any;
  columns: any[];
  pagination: object;
  showPagination: boolean;
}

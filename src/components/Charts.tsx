/** Reusable Recharts wrappers with the app's dark styling. */
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { prettyDate } from '@/lib/utils';

export const CHART_COLORS = ['#8b5cf6', '#3b82f6', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#22d3ee'];

const tooltipStyle = {
  backgroundColor: 'rgba(18,18,26,0.96)',
  border: '1px solid rgba(57,57,74,0.9)',
  borderRadius: 12,
  fontSize: 12,
  color: '#e9e9f0',
  padding: '8px 10px',
};

const axis = { stroke: 'rgba(148,148,168,0.35)', tick: { fontSize: 11 } };

export function ChartFrame({ children, height = 240 }: { children: React.ReactElement; height?: number }) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer width="100%" height="100%">
        {children}
      </ResponsiveContainer>
    </div>
  );
}

export interface Series {
  key: string;
  label: string;
  color?: string;
}

export function TrendLine({
  data,
  x = 'date',
  series,
  height = 240,
}: {
  data: Record<string, any>[];
  x?: string;
  series: Series[];
  height?: number;
}) {
  return (
    <ChartFrame height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,148,168,0.14)" vertical={false} />
        <XAxis dataKey={x} {...axis} tickFormatter={(v: string) => (v?.length === 10 ? v.slice(5) : String(v))} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => (String(v).length === 10 ? prettyDate(String(v)) : String(v))} />
        <Legend wrapperStyle={{ fontSize: 11, color: '#9494a8' }} />
        {series.map((s, i) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}

export function TrendArea({
  data,
  x = 'date',
  series,
  height = 240,
}: {
  data: Record<string, any>[];
  x?: string;
  series: Series[];
  height?: number;
}) {
  return (
    <ChartFrame height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          {series.map((s, i) => {
            const color = s.color ?? CHART_COLORS[i % CHART_COLORS.length];
            return (
              <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.35} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            );
          })}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,148,168,0.14)" vertical={false} />
        <XAxis dataKey={x} {...axis} tickFormatter={(v: string) => (v?.length === 10 ? v.slice(5) : String(v))} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => (String(v).length === 10 ? prettyDate(String(v)) : String(v))} />
        <Legend wrapperStyle={{ fontSize: 11, color: '#9494a8' }} />
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
            fill={`url(#grad-${s.key})`}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    </ChartFrame>
  );
}

export function BarSeries({
  data,
  x = 'name',
  series,
  height = 240,
  stacked,
}: {
  data: Record<string, any>[];
  x?: string;
  series: Series[];
  height?: number;
  stacked?: boolean;
}) {
  return (
    <ChartFrame height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,148,168,0.14)" vertical={false} />
        <XAxis dataKey={x} {...axis} />
        <YAxis {...axis} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} />
        <Legend wrapperStyle={{ fontSize: 11, color: '#9494a8' }} />
        {series.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId={stacked ? 'a' : undefined}
            fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length]}
            radius={[4, 4, 0, 0]}
            maxBarSize={38}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

export function Donut({
  data,
  height = 220,
  innerRadius = 52,
  centerLabel,
  centerValue,
}: {
  data: { name: string; value: number }[];
  height?: number;
  innerRadius?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  return (
    <div className="relative">
      <ChartFrame height={height}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={innerRadius} outerRadius="78%" paddingAngle={2}>
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={CHART_COLORS[i % CHART_COLORS.length]} stroke="rgba(12,12,17,0.6)" />
            ))}
          </Pie>
          <Tooltip contentStyle={tooltipStyle} />
          <Legend wrapperStyle={{ fontSize: 11, color: '#9494a8' }} />
        </PieChart>
      </ChartFrame>
      {centerValue !== undefined && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pb-8">
          <span className="text-xl font-semibold text-ink">{centerValue}</span>
          {centerLabel && <span className="text-[10px] uppercase tracking-wider text-muted">{centerLabel}</span>}
        </div>
      )}
    </div>
  );
}

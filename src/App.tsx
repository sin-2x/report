import {
  Alert,
  Badge,
  Button,
  Card,
  DatePicker,
  Drawer,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  Layout,
  Modal,
  Progress,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CalendarOutlined,
  CopyOutlined,
  EyeOutlined,
  FilterOutlined,
  HistoryOutlined,
  MoonOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
  SunOutlined
} from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import dayjs, { Dayjs } from "dayjs";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import type { ThemeMode } from "./main";

type Product = {
  name: string;
  unit: string;
  group: string;
};

type StockRow = Product & {
  key: string;
  quantity: number | null;
};

type ReportPayload = {
  date: string;
  items: Array<Product & { quantity: number }>;
};

type FormValues = {
  date: Dayjs;
};

type AppProps = {
  themeMode: ThemeMode;
  onThemeChange: (mode: ThemeMode) => void;
};

type ViewMode = "all" | "empty" | "filled";

type ReportHistory = {
  id: string;
  date: string;
  createdAt: string;
  count: number;
  text: string;
};

const storageKey = "morning-stock-groups-v1";
const formStorageKey = "morning-stock-form-v2";
const historyStorageKey = "morning-stock-history-v1";
const allGroups = "Все";
const blue = "#2563eb";

const defaultValues: FormValues = {
  date: dayjs()
};

async function fetchProducts(): Promise<Product[]> {
  try {
    const response = await fetch("/api/items", {
      headers: { Accept: "application/json" }
    });
    const contentType = response.headers.get("content-type") || "";

    if (response.ok && contentType.includes("application/json")) {
      const result = await response.json();
      if (result.ok) return result.items;
      throw new Error(result.error || "Не удалось загрузить список товаров");
    }
  } catch {
    // Static frontend deployments do not have /api; fall back to public/data.txt.
  }

  const dataResponse = await fetch("/data.txt", { cache: "no-store" });

  if (!dataResponse.ok) {
    throw new Error("Не найден data.txt. Для frontend-only деплоя файл data.txt должен быть в public/data.txt.");
  }

  const items = parseProductsText(await dataResponse.text());
  if (!items.length) {
    throw new Error("Файл data.txt найден, но список товаров пустой.");
  }

  return items;
}

async function sendReport(payload: ReportPayload) {
  const response = await fetch("/api/send-report", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload)
  }).catch(() => null);

  if (!response) {
    throw new Error("На frontend-only деплое отправка в Telegram невозможна без backend/serverless.");
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw new Error("На frontend-only деплое отправка в Telegram невозможна без backend/serverless.");
  }

  const result = await response.json();

  if (!response.ok || !result.ok) {
    throw new Error(result.error || "Не удалось отправить отчет");
  }

  return result;
}

function parseProductsText(content: string): Product[] {
  const seen = new Set<string>();
  let currentGroup = "Без группы";
  const items: Product[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const bracketGroup = line.match(/^\[(.+)]$/);
    if (bracketGroup) {
      currentGroup = bracketGroup[1].trim();
      continue;
    }

    const unit = /(^|\s)(кг|kg)(\s|$)/i.test(line) ? "кг" : "шт";
    const key = `${currentGroup}::${line}`.toLocaleLowerCase("ru-RU");
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ name: line, unit, group: currentGroup });
  }

  return items;
}

export default function App({ themeMode, onThemeChange }: AppProps) {
  const [form] = Form.useForm<FormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [modal, modalContextHolder] = Modal.useModal();
  const [search, setSearch] = useState("");
  const [activeGroup, setActiveGroup] = useState(allGroups);
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [formVersion, setFormVersion] = useState(0);
  const [rows, setRows] = useState<StockRow[]>([]);
  const [isRowsLoaded, setIsRowsLoaded] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [history, setHistory] = useState<ReportHistory[]>(() => loadHistory());

  const productsQuery = useQuery({
    queryKey: ["products"],
    queryFn: fetchProducts
  });

  const completedRows = useMemo(() => rows.filter((row) => Number(row.quantity || 0) > 0), [rows]);
  const emptyRows = rows.length - completedRows.length;
  const progress = rows.length ? Math.round((completedRows.length / rows.length) * 100) : 0;
  const previewText = useMemo(
    () => makePreview(form.getFieldsValue(), completedRows),
    [completedRows, form, formVersion]
  );

  const sendMutation = useMutation({
    mutationFn: sendReport,
    onSuccess: (_data, variables) => {
      const nextHistory = saveHistoryEntry({
        date: variables.date,
        count: variables.items.length,
        text: previewText
      });
      setHistory(nextHistory);
      messageApi.success("Отчет отправлен в Telegram");
    },
    onError: (error) => messageApi.error(error.message)
  });

  useEffect(() => {
    if (!productsQuery.data) return;

    const saved = loadSavedQuantities();
    setRows(
      productsQuery.data.map((product) => ({
        ...product,
        key: `${product.group}::${product.name}`,
        quantity: saved[`${product.group}::${product.name}`] ?? null
      }))
    );
    setIsRowsLoaded(true);
  }, [productsQuery.data]);

  useEffect(() => {
    if (!isRowsLoaded) return;

    const timeout = window.setTimeout(() => saveQuantities(rows), 250);
    return () => window.clearTimeout(timeout);
  }, [isRowsLoaded, rows]);

  const groups = useMemo(() => unique(rows.map((row) => row.group)), [rows]);
  const groupStats = useMemo(
    () =>
      groups.map((group) => {
        const groupRows = rows.filter((row) => row.group === group);
        const filled = groupRows.filter((row) => Number(row.quantity || 0) > 0).length;
        return {
          group,
          total: groupRows.length,
          filled,
          progress: groupRows.length ? Math.round((filled / groupRows.length) * 100) : 0
        };
      }),
    [groups, rows]
  );

  const filteredRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ru-RU");
    return rows.filter((row) => {
      const matchesGroup = activeGroup === allGroups || row.group === activeGroup;
      const matchesMode =
        viewMode === "all" ||
        (viewMode === "empty" && Number(row.quantity || 0) <= 0) ||
        (viewMode === "filled" && Number(row.quantity || 0) > 0);
      const matchesSearch =
        !query ||
        row.name.toLocaleLowerCase("ru-RU").includes(query) ||
        row.group.toLocaleLowerCase("ru-RU").includes(query);
      return matchesGroup && matchesMode && matchesSearch;
    });
  }, [activeGroup, rows, search, viewMode]);

  const updateQuantity = useCallback((key: string, value: number | null) => {
    setRows((current) =>
      current.map((row) =>
        row.key === key ? { ...row, quantity: value === null ? null : normalizeQuantity(value) } : row
      )
    );
  }, []);

  const columns = useMemo<ColumnsType<StockRow>>(() => [
    {
      title: "Группа",
      dataIndex: "group",
      key: "group",
      width: 150,
      render: (group: string) => <Tag className="group-tag">{group}</Tag>
    },
    {
      title: "Товар",
      dataIndex: "name",
      key: "name",
      render: (name: string, row) => (
        <Space direction="vertical" size={2}>
          <Typography.Text className="product-title">{name}</Typography.Text>
          <Typography.Text type="secondary">Единица: {row.unit}</Typography.Text>
        </Space>
      )
    },
    {
      title: "Остаток утром",
      dataIndex: "quantity",
      key: "quantity",
      width: 360,
      render: (_, row) => <QuantityControl row={row} onChange={updateQuantity} />
    }
  ], [updateQuantity]);

  function handleValuesChange() {
    saveFormDraft(form.getFieldsValue());
    setFormVersion((current) => current + 1);
  }

  function makePayload(values: FormValues): ReportPayload {
    return {
      date: values.date.format("DD.MM.YYYY"),
      items: completedRows.map((row) => ({
        name: row.name,
        group: row.group,
        quantity: Number(row.quantity),
        unit: row.unit
      }))
    };
  }

  function handleSubmit(values: FormValues) {
    if (!completedRows.length) {
      messageApi.warning("Заполните количество хотя бы у одного товара");
      return;
    }

    const payload = makePayload(values);
    modal.confirm({
      title: "Отправить отчет?",
      content: `Заполнено ${completedRows.length} из ${rows.length}. В Telegram попадут только товары с количеством.`,
      okText: "Отправить",
      cancelText: "Проверить еще",
      centered: true,
      onOk: () => sendMutation.mutate(payload)
    });
  }

  async function copyReport(text = previewText) {
    await navigator.clipboard.writeText(text);
    messageApi.success("Отчет скопирован");
  }

  function clearQuantities() {
    modal.confirm({
      title: "Очистить все количества?",
      content: "Сохраненные значения в этой перекличке будут удалены.",
      okText: "Очистить",
      cancelText: "Отмена",
      centered: true,
      onOk: () => {
        setRows((current) => current.map((row) => ({ ...row, quantity: null })));
        messageApi.success("Количество очищено");
      }
    });
  }

  function showEmptyOnly() {
    setViewMode("empty");
    setActiveGroup(allGroups);
    setSearch("");
    messageApi.info("Показаны незаполненные товары");
  }

  function resetFilters() {
    setViewMode("all");
    setActiveGroup(allGroups);
    setSearch("");
  }

  return (
    <Layout className="app-layout">
      {contextHolder}
      {modalContextHolder}
      <main className="app-page">
        <section className="work-panel">
          <div className="hero-band">
            <Flex justify="space-between" align="flex-start" gap={16} className="page-head">
              <div className="title-block">
                <Typography.Text className="eyebrow">Остатки</Typography.Text>
                <Typography.Title level={1}>Перекличка</Typography.Title>
                <div className="compact-stats">
                  <span>{rows.length} товаров</span>
                  <span>{completedRows.length} заполнено</span>
                  <span>{emptyRows} осталось</span>
                </div>
              </div>

              <div className="header-actions">
                <Tooltip title={themeMode === "dark" ? "Светлая тема" : "Темная тема"}>
                  <Button
                    className="header-icon-button"
                    aria-label="Переключить тему"
                    icon={themeMode === "dark" ? <SunOutlined /> : <MoonOutlined />}
                    onClick={() => onThemeChange(themeMode === "dark" ? "light" : "dark")}
                  />
                </Tooltip>
                <Tooltip title="Сообщение">
                  <Button
                    className="header-icon-button"
                    aria-label="Открыть сообщение"
                    icon={<EyeOutlined />}
                    onClick={() => setIsPreviewOpen(true)}
                  />
                </Tooltip>
                <Tooltip title="История">
                  <Button
                    className="header-icon-button"
                    aria-label="Открыть историю"
                    icon={<HistoryOutlined />}
                    onClick={() => setIsHistoryOpen(true)}
                  />
                </Tooltip>
                <Tooltip title="Очистить количество">
                  <Button
                    className="header-icon-button"
                    aria-label="Очистить количество"
                    icon={<ReloadOutlined />}
                    onClick={clearQuantities}
                  />
                </Tooltip>
              </div>
            </Flex>
            <Progress percent={progress} strokeColor={blue} showInfo={false} size="small" />
          </div>

          <Form
            form={form}
            layout="vertical"
            initialValues={loadFormDraft()}
            onFinish={handleSubmit}
            onValuesChange={handleValuesChange}
          >
            <Card className="details-card date-only-card" bordered={false}>
              <Form.Item name="date" label="Дата">
                <DatePicker className="full-width" format="DD.MM.YYYY" suffixIcon={<CalendarOutlined />} />
              </Form.Item>
            </Card>

            <Card className="table-card" bordered={false}>
              <div className="premium-strip">
                <div className="premium-metric">
                  <span>Готовность</span>
                  <strong>{progress}%</strong>
                </div>
                <div className="premium-metric">
                  <span>К отправке</span>
                  <strong>{completedRows.length}</strong>
                </div>
                <div className="premium-metric">
                  <span>Осталось</span>
                  <strong>{emptyRows}</strong>
                </div>
                <Button icon={<FilterOutlined />} onClick={showEmptyOnly}>
                  Пустые
                </Button>
              </div>

              <div className="group-rail">
                <button
                  type="button"
                  className={activeGroup === allGroups ? "group-chip is-active" : "group-chip"}
                  onClick={resetFilters}
                >
                  <span>Все</span>
                  <strong>{completedRows.length}/{rows.length}</strong>
                </button>
                {groupStats.map((stat) => (
                  <button
                    type="button"
                    key={stat.group}
                    className={activeGroup === stat.group ? "group-chip is-active" : "group-chip"}
                    onClick={() => {
                      setActiveGroup(stat.group);
                      setViewMode("all");
                      setSearch("");
                    }}
                  >
                    <span>{stat.group}</span>
                    <strong>{stat.filled}/{stat.total}</strong>
                    <i style={{ width: `${stat.progress}%` }} />
                  </button>
                ))}
              </div>

              {productsQuery.isError ? (
                <Alert
                  className="api-alert"
                  type="error"
                  showIcon
                  message="Товары не загрузились"
                  description={productsQuery.error.message}
                />
              ) : null}

              {!productsQuery.isLoading && !productsQuery.isError && rows.length === 0 ? (
                <Alert
                  className="api-alert"
                  type="warning"
                  showIcon
                  message="Список товаров пустой"
                  description="Проверьте файл data.txt на сервере."
                />
              ) : null}

              <Flex className="toolbar" justify="space-between" gap={12}>
                <Input
                  allowClear
                  size="large"
                  prefix={<SearchOutlined />}
                  value={search}
                  placeholder="Поиск товара или группы"
                  onChange={(event) => setSearch(event.target.value)}
                />
                <Select
                  size="large"
                  className="group-select"
                  value={activeGroup}
                  suffixIcon={<FilterOutlined />}
                  options={[allGroups, ...groups].map((group) => ({
                    value: group,
                    label: group === allGroups ? "Все группы" : group
                  }))}
                  onChange={(value) => setActiveGroup(value)}
                />
                <Segmented
                  className="mode-switch"
                  value={viewMode}
                  options={[
                    { label: "Все", value: "all" },
                    { label: "Незаполненные", value: "empty" },
                    { label: "Готовые", value: "filled" }
                  ]}
                  onChange={(value) => setViewMode(value as ViewMode)}
                />
                <Badge count={`${filteredRows.length} показано`} color={blue} />
              </Flex>

              <Table
                className="stock-table desktop-table"
                rowKey="key"
                rowClassName={(row) => (Number(row.quantity || 0) > 0 ? "row-filled" : "")}
                columns={columns}
                dataSource={filteredRows}
                loading={productsQuery.isLoading}
                pagination={false}
                sticky
                scroll={{ y: 540 }}
              />

              <div className="mobile-list">
                {productsQuery.isLoading ? (
                  <Card loading />
                ) : filteredRows.length ? (
                  filteredRows.map((row) => (
                    <Card
                      key={row.key}
                      className={Number(row.quantity || 0) > 0 ? "mobile-product is-filled" : "mobile-product"}
                      bordered={false}
                    >
                      <Flex justify="space-between" gap={12} align="center">
                        <div>
                          <Tag className="group-tag">{row.group}</Tag>
                          <Typography.Title level={5}>{row.name}</Typography.Title>
                        </div>
                        <QuantityControl row={row} onChange={updateQuantity} />
                      </Flex>
                    </Card>
                  ))
                ) : (
                  <Empty description="Ничего не найдено" />
                )}
              </div>
            </Card>

            <Flex justify="space-between" align="center" gap={10} className="actions">
              <div className="send-summary">
                <span>Готово к отправке</span>
                <strong>{completedRows.length} позиций</strong>
              </div>
              <div className="send-buttons">
              <Button icon={<EyeOutlined />} onClick={() => setIsPreviewOpen(true)}>
                Сообщение
              </Button>
              <Button icon={<CopyOutlined />} onClick={() => copyReport()}>
                Скопировать
              </Button>
              <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={sendMutation.isPending}>
                Отправить
              </Button>
              </div>
            </Flex>
          </Form>
        </section>
      </main>

      <Drawer
        title="Сообщение в Telegram"
        placement="left"
        width={420}
        open={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        extra={<Badge count={completedRows.length} color={blue} />}
      >
        <pre className="drawer-preview">{previewText}</pre>
        <Button block icon={<CopyOutlined />} onClick={() => copyReport()}>
          Скопировать
        </Button>
      </Drawer>

      <Drawer
        title="История отчетов"
        placement="right"
        width={430}
        open={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
      >
        {history.length ? (
          <div className="history-list">
            {history.map((entry) => (
              <Card key={entry.id} className="history-card" bordered={false}>
                <Flex justify="space-between" align="center" gap={10}>
                  <div>
                    <Typography.Text strong>{entry.date}</Typography.Text>
                    <Typography.Text type="secondary" className="history-time">
                      {dayjs(entry.createdAt).format("HH:mm")} · {entry.count} позиций
                    </Typography.Text>
                  </div>
                  <Button icon={<CopyOutlined />} onClick={() => copyReport(entry.text)} />
                </Flex>
                <pre>{entry.text}</pre>
              </Card>
            ))}
          </div>
        ) : (
          <Empty description="История появится после отправки" />
        )}
      </Drawer>
    </Layout>
  );
}

const QuantityControl = memo(function QuantityControl({
  row,
  onChange
}: {
  row: StockRow;
  onChange: (key: string, value: number | null) => void;
}) {
  const [draft, setDraft] = useState<number | null>(toInputValue(row.quantity));

  useEffect(() => {
    setDraft(toInputValue(row.quantity));
  }, [row.quantity]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const nextValue = normalizeInputValue(draft);
      if (nextValue !== row.quantity) onChange(row.key, nextValue);
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [draft, onChange, row.key, row.quantity]);

  return (
    <div className="quantity-control">
      <InputNumber
        min={0}
        step={0.5}
        precision={2}
        decimalSeparator=","
        inputMode="numeric"
        value={draft}
        placeholder="0"
        addonAfter={row.unit}
        className="quantity-input"
        data-quantity-key={row.key}
        parser={(value) => Number(value?.replace(",", ".") || 0)}
        onChange={(value) => setDraft(normalizeInputValue(value))}
        onKeyDown={(event) => handleQuantityKeyDown(event, row.key)}
      />
    </div>
  );
});

function handleQuantityKeyDown(event: KeyboardEvent<HTMLInputElement>, key: string) {
  if (event.key !== "Enter") return;
  event.preventDefault();
  focusNextQuantity(key);
}

function focusNextQuantity(key: string) {
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("[data-quantity-key]"));
  const currentIndex = inputs.findIndex((input) => input.dataset.quantityKey === key);
  const nextInput = inputs[currentIndex + 1] || inputs[0];
  nextInput?.focus();
  nextInput?.select();
}

function toInputValue(value: number | null) {
  return value === null || value === undefined || value <= 0 ? null : value;
}

function normalizeInputValue(value: string | number | null) {
  if (value === null || value === "") return null;
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) && number > 0 ? normalizeQuantity(number) : null;
}

function normalizeQuantity(value: number) {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function formatQuantity(value: number | null) {
  return Number(value || 0).toLocaleString("ru-RU", {
    maximumFractionDigits: 2
  });
}

function makePreview(values: Partial<FormValues>, rows: StockRow[]) {
  const date = values.date?.format("DD.MM.YYYY") || dayjs().format("DD.MM.YYYY");
  const lines = ["Проверка остатка в магазине", `Дата: ${date}`, "", "Остаток от вчера:"];

  if (!rows.length) {
    lines.push("- пока ничего не заполнено");
    return lines.join("\n");
  }

  for (const group of unique(rows.map((row) => row.group))) {
    lines.push("", group);
    rows
      .filter((row) => row.group === group)
      .forEach((row) => {
        lines.push(`- ${row.name}: ${formatQuantity(row.quantity)} ${row.unit}`);
      });
  }

  return lines.join("\n");
}

function loadSavedQuantities() {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}") as Record<string, number | null>;
  } catch {
    return {};
  }
}

function saveQuantities(rows: StockRow[]) {
  const quantities = rows.reduce<Record<string, number | null>>((acc, row) => {
    acc[row.key] = row.quantity;
    return acc;
  }, {});
  localStorage.setItem(storageKey, JSON.stringify(quantities));
}

function loadFormDraft(): FormValues {
  try {
    const saved = JSON.parse(localStorage.getItem(formStorageKey) || "{}") as { date?: string };
    return { date: saved.date ? dayjs(saved.date) : defaultValues.date };
  } catch {
    return defaultValues;
  }
}

function saveFormDraft(values: Partial<FormValues>) {
  localStorage.setItem(
    formStorageKey,
    JSON.stringify({
      date: values.date?.format("YYYY-MM-DD") || dayjs().format("YYYY-MM-DD")
    })
  );
}

function loadHistory(): ReportHistory[] {
  try {
    return JSON.parse(localStorage.getItem(historyStorageKey) || "[]") as ReportHistory[];
  } catch {
    return [];
  }
}

function saveHistoryEntry(entry: Omit<ReportHistory, "id" | "createdAt">) {
  const nextEntry: ReportHistory = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString()
  };
  const nextHistory = [nextEntry, ...loadHistory()].slice(0, 10);
  localStorage.setItem(historyStorageKey, JSON.stringify(nextHistory));
  return nextHistory;
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

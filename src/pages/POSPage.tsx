import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useDeviceMode } from '@/lib/deviceMode';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/auth';
import { formatCurrency, generateFolio } from '@/lib/format';
import { PROGRAM_LOGO } from '@/lib/branding';
import { printTicket, buildTicketText, buildWhatsAppUrl, generateQrDataUrl, generateTicketPdfBase64, type TicketData } from '@/components/TicketPrint';
import POSSubMenu from '@/components/POSSubMenu';
import BarcodeScanner from '@/components/BarcodeScanner';
import PhoneDigitsInput from '@/components/PhoneDigitsInput';
import type { Product, ProductBranchPrice, ProductPresentation, SaleItem, Customer, Ad, BankAccount, WalletSaleResult } from '@/lib/types';
import { effectivePrices } from '@/lib/branchPrices';
import Button from '@/components/Button';
import { SearchInput, Spinner } from '@/components/ui';
import { searchAndRank } from '@/lib/search';
import Modal from '@/components/Modal';
import ExtensionBridgeTest, { type RechargeResult, type RechargeServiceData } from '@/components/ExtensionBridgeTest';
import { Field, Input, Select, Textarea } from '@/components/Field';
import {
  Plus, Minus, Trash2, ShoppingCart, X, Image as ImageIcon,
  CreditCard, Banknote, ArrowLeftRight, Ticket, WalletCards, FileCheck2,
  UserPlus, CheckCircle2, AlertTriangle, ScanLine, Building2, Upload, Landmark,
  Lock, MessageCircle, Mail, Send,
} from 'lucide-react';

interface CartItem extends SaleItem {
  stock: number;
  image_url: string | null;
  sku: string | null;
  tax_rate: number;
  ieps_rate: number;
  bulk: boolean;
  presentation_id: string | null;
  pieces_per_unit: number;
  barcode: string | null;
}

const calculateLineTotal = (quantity: number, unitPrice: number, discount = 0): number => {
  const safeDiscount = Math.min(100, Math.max(0, discount));
  return quantity * unitPrice * (1 - safeDiscount / 100);
};

const cartLineKey = (item: Pick<CartItem, 'product_id' | 'presentation_id'>): string => item.presentation_id ?? item.product_id ?? '';

const piecesInCart = (cart: CartItem[], productId: string, excludeKey?: string): number => cart
  .filter((i) => i.product_id === productId && cartLineKey(i) !== excludeKey)
  .reduce((sum, i) => sum + i.quantity * i.pieces_per_unit, 0);

const PAYMENT_METHODS = [
  { value: 'efectivo', label: 'Efectivo', icon: <Banknote size={17} /> },
  { value: 'tarjeta', label: 'Tarjeta', icon: <CreditCard size={17} /> },
  { value: 'transferencia', label: 'Transferencia', icon: <ArrowLeftRight size={17} /> },
  { value: 'vale', label: 'Vale', icon: <Ticket size={17} /> },
  { value: 'cheque', label: 'Cheque', icon: <FileCheck2 size={17} /> },
  { value: 'credito', label: 'Crédito', icon: <WalletCards size={17} />, requiresCustomer: true },
  { value: 'monedero_electronico', label: 'Monedero electrónico', icon: <WalletCards size={17} />, requiresCustomer: true },
  { value: 'mixto', label: 'Pago mixto', icon: <ArrowLeftRight size={17} /> },
];

export default function POSPage() {
  const { user, profile, currentBranch } = useAuth();
  const { mode } = useDeviceMode();
  const [products, setProducts] = useState<Product[]>([]);
  const [presentations, setPresentations] = useState<ProductPresentation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [ads, setAds] = useState<Ad[]>([]);
  const [adIndex, setAdIndex] = useState(0);
  const [taxRate, setTaxRate] = useState(0.16);
  const [currencySymbol, setCurrencySymbol] = useState('$');
  const [ticketWidth, setTicketWidth] = useState<'55' | '80'>('80');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedBankAccount, setSelectedBankAccount] = useState<BankAccount | null>(null);
  const [cardType, setCardType] = useState<'debito' | 'credito'>('debito');
  const [cardLast4, setCardLast4] = useState('');
  const [cardBank, setCardBank] = useState('');
  const [authorizationNumber, setAuthorizationNumber] = useState('');
  const [nipMode, setNipMode] = useState<'con_nip' | 'sin_nip'>('con_nip');
  const [noNipName, setNoNipName] = useState('');
  const [noNipAddress, setNoNipAddress] = useState('');
  const [noNipPhone, setNoNipPhone] = useState('');
  const [ticketSigned, setTicketSigned] = useState<'si' | 'no'>('no');
  const [transferOriginBank, setTransferOriginBank] = useState('');
  const [transferConcept, setTransferConcept] = useState('');
  const [transferOriginAccount, setTransferOriginAccount] = useState('');
  const [transferReceipt, setTransferReceipt] = useState<File | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('efectivo');
  const [amountReceived, setAmountReceived] = useState('');
  const [discount, setDiscount] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');
  const [walletPhone, setWalletPhone] = useState('');
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletLookupBusy, setWalletLookupBusy] = useState(false);
  const [walletRedeem, setWalletRedeem] = useState('');
  const [saveChangeToWallet, setSaveChangeToWallet] = useState(false);
  const [changeToWallet, setChangeToWallet] = useState('');
  const [walletPinOpen, setWalletPinOpen] = useState(false);
  const [walletPinCode, setWalletPinCode] = useState('');
  const [walletPinSending, setWalletPinSending] = useState(false);
  const [walletPinVerifying, setWalletPinVerifying] = useState(false);
  const [walletPinError, setWalletPinError] = useState<string | null>(null);
  const [walletVerificationId, setWalletVerificationId] = useState<string | null>(null);
  const [mixedMethods, setMixedMethods] = useState<string[]>(['efectivo', 'tarjeta']);
  const [mixedAmounts, setMixedAmounts] = useState<Record<string, string>>({ efectivo: '', tarjeta: '' });
  const [processing, setProcessing] = useState(false);
  const [lastSale, setLastSale] = useState<TicketData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanAlert, setScanAlert] = useState<string | null>(null);
  const [turnChecked, setTurnChecked] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sendPhone, setSendPhone] = useState('');
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string>('');
  const [saleStartedAt, setSaleStartedAt] = useState<number | null>(null);
  const [saleElapsed, setSaleElapsed] = useState(0);
  const [newSaleOpen, setNewSaleOpen] = useState(false);
  const [pendingRecharge, setPendingRecharge] = useState<RechargeServiceData | null>(null);
  const [executeRecharge, setExecuteRecharge] = useState<RechargeServiceData | null>(null);
  const [rechargeTransactionId, setRechargeTransactionId] = useState<string | null>(null);
  const [rechargeConfirmation, setRechargeConfirmation] = useState<{ result: RechargeResult; reason: string } | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const lastScanRef = useRef<{ code: string; time: number } | null>(null);
  const [bulkProduct, setBulkProduct] = useState<Product | null>(null);
  const [bulkQuantity, setBulkQuantity] = useState('1');
  const [bulkAmount, setBulkAmount] = useState('');
  const [allowAdminSellWithoutStock, setAllowAdminSellWithoutStock] = useState(false);
  const [rechargeDepartmentId, setRechargeDepartmentId] = useState('');
  const [rechargeMarginType, setRechargeMarginType] = useState('porcentaje');
  const [rechargeMarginValue, setRechargeMarginValue] = useState(0);
  const [newCustomerOpen, setNewCustomerOpen] = useState(false);
  const [ncName, setNcName] = useState('');
  const [ncPaterno, setNcPaterno] = useState('');
  const [ncMaterno, setNcMaterno] = useState('');
  const [ncPhone, setNcPhone] = useState('');
  const [ncCalle, setNcCalle] = useState('');
  const [ncNumero, setNcNumero] = useState('');
  const [ncColonia, setNcColonia] = useState('');
  const [ncPoblacion, setNcPoblacion] = useState('');
  const [ncMunicipio, setNcMunicipio] = useState('');
  const [ncSaving, setNcSaving] = useState(false);
  const [ncError, setNcError] = useState<string | null>(null);

  const isAdmin = profile?.role?.permissions?.includes('all') ?? false;
  const canSellWithoutStock = isAdmin && allowAdminSellWithoutStock;

  const subMenu = POSSubMenu({ onTurnChange: () => loadProducts() });
  const activeRegister = subMenu.activeRegister;

  // Auto-show welcome modal when no turn is open on first load
  useEffect(() => {
    if (!subMenu.loadingTurn && activeRegister && !saleStartedAt && !newSaleOpen && !subMenu.welcomeOpen) {
      setNewSaleOpen(true);
    }
  }, [subMenu.loadingTurn, activeRegister, saleStartedAt, newSaleOpen, subMenu.welcomeOpen]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !checkoutOpen && !lastSale) setNewSaleOpen(true);
      if (event.key !== 'F3' || lastSale) return;
      event.preventDefault();
      if (checkoutOpen) {
        if (!processing) void attemptSale();
        return;
      }
      if (newSaleOpen || !saleStartedAt) {
        startNewSale();
        return;
      }
      if (cart.length > 0) setCheckoutOpen(true);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  });

  useEffect(() => {
    if (!checkoutOpen) return;
    const timer = window.setTimeout(() => document.getElementById('pos-amount-received')?.focus(), 50);
    return () => window.clearTimeout(timer);
  }, [checkoutOpen, paymentMethod]);

  useEffect(() => {
    if (!saleStartedAt) return;
    const update = () => setSaleElapsed(Math.max(0, Math.floor((Date.now() - saleStartedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [saleStartedAt]);

  useEffect(() => () => {
    if (scanTimerRef.current !== null) window.clearTimeout(scanTimerRef.current);
  }, []);

  useEffect(() => {
    if (!subMenu.loadingTurn && !turnChecked && !subMenu.welcomeOpen) {
      setTurnChecked(true);
      if (!activeRegister) {
        subMenu.setWelcomeOpen(true);
      }
    }
  }, [subMenu.loadingTurn, activeRegister, turnChecked, subMenu.welcomeOpen]);

  const loadProducts = useCallback(async () => {
    if (!currentBranch) return;
    const allProducts: Product[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('products')
        .select('*, category:categories(*)')
        .eq('active', true)
        .order('name')
        .range(from, from + 999);
      if (error) { console.error(error); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); return; }
      allProducts.push(...((data as Product[]) ?? []));
      if ((data ?? []).length < 1000) break;
    }
    const allStock: { product_id: string; quantity: number }[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: stockPage, error: stockErr } = await supabase
        .from('product_stock')
        .select('product_id, quantity')
        .eq('branch_id', currentBranch.id)
        .range(from, from + 999);
      if (stockErr) {
        console.error(stockErr);
        setError('No se pudo consultar la existencia de esta sucursal.');
        setLoading(false);
        return;
      }
      allStock.push(...((stockPage as { product_id: string; quantity: number }[]) ?? []));
      if ((stockPage ?? []).length < 1000) break;
    }
    const sMap = new Map<string, number>();
    allStock.forEach((s) => { sMap.set(s.product_id, Number(s.quantity)); });
    const { data: presentationData, error: presentationErr } = await supabase
      .from('product_presentations')
      .select('*')
      .eq('active', true);
    if (presentationErr) {
      console.error(presentationErr);
      setError('No se pudieron cargar las presentaciones de venta.');
      setLoading(false);
      return;
    }
    const branchPriceRows: ProductBranchPrice[] = [];
    for (let from = 0; ; from += 1000) {
      const { data: pricePage, error: priceErr } = await supabase
        .from('product_branch_prices')
        .select('*')
        .eq('branch_id', currentBranch.id)
        .range(from, from + 999);
      if (priceErr) {
        console.error(priceErr);
        setError('No se pudieron cargar los precios de esta sucursal.');
        setLoading(false);
        return;
      }
      branchPriceRows.push(...((pricePage as ProductBranchPrice[]) ?? []));
      if ((pricePage ?? []).length < 1000) break;
    }
    const branchPriceByProduct = new Map(branchPriceRows.map((r) => [r.product_id, r]));
    setPresentations(((presentationData as ProductPresentation[]) ?? []).map((p) => ({ ...p, pieces: Number(p.pieces), sale_price: Number(p.sale_price) })));
    setProducts(allProducts.map((p) => ({ ...p, ...effectivePrices(p, branchPriceByProduct.get(p.id)) })));
    setStockMap(sMap);
    setLoading(false);
  }, [currentBranch]);

  const [stockMap, setStockMap] = useState<Map<string, number>>(new Map());

  const loadAds = useCallback(async () => {
    const { data } = await supabase
      .from('ads')
      .select('*')
      .eq('active', true)
      .order('sort_order');
    setAds((data as Ad[]) ?? []);
  }, []);

  const loadSettings = useCallback(async () => {
    const { data } = await supabase.from('settings').select('key, value');
    const map: Record<string, string> = {};
    (data ?? []).forEach((r: { key: string; value: string }) => { map[r.key] = r.value; });
    setTaxRate(parseFloat(map.tax_rate ?? '0.16'));
    setCurrencySymbol(map.currency_symbol ?? '$');
    setTicketWidth(map.ticket_width === '55' ? '55' : '80');
    setAllowAdminSellWithoutStock(map.allow_admin_sell_without_stock === 'true');
    setRechargeDepartmentId(map.recharge_department_id ?? '');
    setRechargeMarginType(map.recharge_margin_type ?? 'porcentaje');
    setRechargeMarginValue(Number(map.recharge_margin_value ?? 0));
  }, []);

  const loadCustomers = useCallback(async () => {
    const { data } = await supabase.from('customers').select('*').order('name').limit(200);
    setCustomers((data as Customer[]) ?? []);
  }, []);

  const loadBankAccounts = useCallback(async () => {
    const { data } = await supabase.from('bank_accounts').select('*').eq('active', true).order('bank_name');
    setBankAccounts((data as BankAccount[]) ?? []);
  }, []);

  useEffect(() => {
    loadProducts();
    loadAds();
    loadSettings();
    loadCustomers();
    loadBankAccounts();
  }, [loadProducts, loadAds, loadSettings, loadCustomers, loadBankAccounts]);

  // Rotate ads every 6 seconds
  useEffect(() => {
    if (ads.length <= 1) return;
    const t = setInterval(() => setAdIndex((i) => (i + 1) % ads.length), 6000);
    return () => clearInterval(t);
  }, [ads.length]);

  const searchEntries = useMemo(() => {
    const productEntries = searchAndRank(search, products, (p) => [p.name, p.sku, p.barcode, p.barcode_2])
      .map((product) => ({ key: product.id, product, presentation: null as ProductPresentation | null }));
    const productById = new Map(products.map((p) => [p.id, p]));
    const presentationRows = presentations.flatMap((presentation) => {
      const product = productById.get(presentation.product_id);
      return product ? [{ presentation, product }] : [];
    });
    const presentationEntries = searchAndRank(search, presentationRows, (row) => [row.presentation.name, row.presentation.code, row.product.name])
      .map((row) => ({ key: row.presentation.id, product: row.product, presentation: row.presentation }));
    return [...productEntries, ...presentationEntries];
  }, [products, presentations, search]);

  const getAvailableStock = (product: Product, availableStock = stockMap): number => (
    product.track_inventory ? availableStock.get(product.id) ?? 0 : Number.POSITIVE_INFINITY
  );

  const refreshProductStock = async (productId: string): Promise<Map<string, number> | null> => {
    if (!currentBranch) return null;
    const { data, error } = await supabase
      .from('product_stock')
      .select('product_id, quantity')
      .eq('product_id', productId)
      .eq('branch_id', currentBranch.id)
      .maybeSingle();
    if (error) {
      console.error(error);
      return null;
    }
    const nextStockMap = new Map(stockMap);
    nextStockMap.set(productId, Number(data?.quantity ?? 0));
    setStockMap(nextStockMap);
    return nextStockMap;
  };

  const handleScan = async (codeArg?: string) => {
    const code = (codeArg ?? search).trim();
    if (!code) return;
    if (lastScanRef.current && lastScanRef.current.code === code && Date.now() - lastScanRef.current.time < 800) {
      setSearch('');
      return;
    }
    lastScanRef.current = { code, time: Date.now() };
    setScanAlert(null);
    const presentation = presentations.find((pr) => pr.code.toLowerCase() === code.toLowerCase()) ?? null;
    let match = presentation
      ? products.find((p) => p.id === presentation.product_id)
      : products.find(
        (p) => (p.barcode ?? '').toLowerCase() === code.toLowerCase() || (p.barcode_2 ?? '').toLowerCase() === code.toLowerCase() || (p.sku ?? '').toLowerCase() === code.toLowerCase() || p.name.toLowerCase() === code.toLowerCase()
      );
    if (!match) {
      const { data: dbProduct } = await supabase
        .from('products')
        .select('*, category:categories(*)')
        .eq('active', true)
        .or(`barcode.eq.${code},barcode_2.eq.${code},sku.eq.${code}`)
        .maybeSingle();
      if (dbProduct && currentBranch) {
        const { data: branchPrice } = await supabase
          .from('product_branch_prices')
          .select('*')
          .eq('product_id', (dbProduct as Product).id)
          .eq('branch_id', currentBranch.id)
          .maybeSingle();
        match = { ...(dbProduct as Product), ...effectivePrices(dbProduct as Product, (branchPrice as ProductBranchPrice | null) ?? undefined) };
        setProducts((prev) => {
          if (prev.some((p) => p.id === match!.id)) return prev;
          return [...prev, { ...match!, sale_price: Number(match!.sale_price) }];
        });
      }
    }
    if (!match) {
      setScanAlert(`ALERTA: Producto no agregado. El código "${code}" no existe.`);
      setSearch('');
      return;
    }
    let availableStock = stockMap;
    if (match.track_inventory) {
      availableStock = await refreshProductStock(match.id) ?? availableStock;
    }
    const stock = getAvailableStock(match, availableStock);
    if (stock <= 0 && !canSellWithoutStock) {
      setScanAlert(`ALERTA: Producto no agregado. "${match.name}" sin stock.`);
      setSearch('');
      return;
    }
    addToCart(match, availableStock, presentation);
    setSearch('');
  };

  useEffect(() => {
    if (!activeRegister || scannerOpen || checkoutOpen || lastSale || newSaleOpen) return;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [activeRegister, scannerOpen, checkoutOpen, lastSale, newSaleOpen, search]);

  const openBulkQuantity = (product: Product) => {
    setBulkProduct(product);
    setBulkQuantity('1');
    setBulkAmount(Number(product.sale_price).toFixed(2));
  };

  const addBulkToCart = () => {
    if (!bulkProduct) return;
    const quantity = Number(bulkQuantity);
    const amount = Number(bulkAmount);
    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(amount) || amount <= 0) return;
    const stock = getAvailableStock(bulkProduct);
    if (quantity > stock && !canSellWithoutStock) {
      setScanAlert(`ALERTA: La cantidad supera la existencia disponible de ${bulkProduct.name}.`);
      return;
    }
    setCart((prev) => {
      const existing = prev.find((item) => cartLineKey(item) === bulkProduct.id);
      if (existing) {
        const nextQuantity = existing.quantity + quantity;
        return prev.map((item) => cartLineKey(item) === bulkProduct.id
          ? { ...item, quantity: nextQuantity, line_total: calculateLineTotal(nextQuantity, item.unit_price, item.discount ?? 0) }
          : item);
      }
      return [...prev, {
        product_id: bulkProduct.id,
        product_name: bulkProduct.name,
        quantity,
        unit_price: Number(bulkProduct.sale_price),
        discount: 0,
        line_total: amount,
        stock,
        image_url: bulkProduct.image_url,
        sku: bulkProduct.sku,
        barcode: bulkProduct.barcode,
        tax_rate: Number(bulkProduct.tax_rate ?? 0),
        ieps_rate: Number(bulkProduct.ieps_rate ?? 0),
        bulk: true,
        presentation_id: null,
        pieces_per_unit: 1,
      }];
    });
    setBulkProduct(null);
    setBulkQuantity('1');
    setBulkAmount('');
  };

  const addToCart = (product: Product, availableStock = stockMap, presentation: ProductPresentation | null = null) => {
    if (product.bulk) {
      openBulkQuantity(product);
      return;
    }
    const stock = getAvailableStock(product, availableStock);
    setCart((prev) => {
      const key = presentation?.id ?? product.id;
      const existing = prev.find((i) => cartLineKey(i) === key);
      const qty = existing ? existing.quantity + 1 : 1;
      const pieces = presentation?.pieces ?? 1;
      if (!canSellWithoutStock && piecesInCart(prev, product.id, key) + qty * pieces > stock) return prev;
      if (existing) {
        return prev.map((i) =>
          cartLineKey(i) === key
            ? { ...i, quantity: qty, line_total: calculateLineTotal(qty, i.unit_price, i.discount ?? 0) }
            : i
        );
      }
      return [
        ...prev,
        {
          product_id: product.id,
          presentation_id: presentation?.id ?? null,
          pieces_per_unit: pieces,
          product_name: presentation ? `${product.name} - ${presentation.name}` : product.name,
          quantity: 1,
          unit_price: Number(presentation ? presentation.sale_price : product.sale_price),
          discount: 0,
          line_total: Number(presentation ? presentation.sale_price : product.sale_price),
          stock,
          image_url: presentation?.image_url ?? product.image_url,
          sku: product.sku,
          barcode: product.barcode,
          tax_rate: Number(product.tax_rate ?? 0),
          ieps_rate: Number(product.ieps_rate ?? 0),
          bulk: false,
        },
      ];
    });
  };

  const changeQty = (lineKey: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (cartLineKey(i) !== lineKey) return i;
          const q = i.quantity + delta;
          if (q <= 0) return null;
          if (!canSellWithoutStock && piecesInCart(prev, i.product_id!, lineKey) + q * i.pieces_per_unit > i.stock) return i;
          return { ...i, quantity: q, line_total: calculateLineTotal(q, i.unit_price, i.discount ?? 0) };
        })
        .filter(Boolean) as CartItem[]
    );
  };

  const removeItem = (lineKey: string) => {
    setCart((prev) => prev.filter((i) => cartLineKey(i) !== lineKey));
  };

  const updateItemDiscount = (lineKey: string, value: string) => {
    const nextDiscount = Math.min(100, Math.max(0, Number(value) || 0));
    setCart((prev) => prev.map((item) => cartLineKey(item) === lineKey
      ? { ...item, discount: nextDiscount, line_total: calculateLineTotal(item.quantity, item.unit_price, nextDiscount) }
      : item
    ));
  };

  const startNewSale = () => {
    clearCart();
    setError(null);
    setSaleElapsed(0);
    setSaleStartedAt(Date.now());
    setNewSaleOpen(false);
  };

  const formatSaleElapsed = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };

  const clearCart = () => {
    setCart([]);
    setSelectedCustomer(null);
    setSelectedBankAccount(null);
    setPaymentMethod('efectivo');
    setCardLast4('');
    setCardBank('');
    setAuthorizationNumber('');
    setNipMode('con_nip');
    setNoNipName('');
    setNoNipAddress('');
    setNoNipPhone('');
    setTicketSigned('no');
    setTransferOriginBank('');
    setTransferConcept('');
    setTransferOriginAccount('');
    setTransferReceipt(null);
    setDiscount('');
    setAmountReceived('');
    setWalletPhone('');
    setWalletError(null);
    setWalletRedeem('');
    setSaveChangeToWallet(false);
    setChangeToWallet('');
    setMixedMethods(['efectivo', 'tarjeta']);
    setMixedAmounts({ efectivo: '', tarjeta: '' });
  };

  const subtotal = cart.reduce((s, i) => s + i.line_total, 0);
  const discountVal = parseFloat(discount) || 0;
  const total = Math.max(0, subtotal - discountVal);
  const tax = cart.reduce((sum, item) => {
    const rate = (Number(item.tax_rate ?? 0) + Number(item.ieps_rate ?? 0)) / 100;
    return sum + (rate > 0 ? item.line_total - (item.line_total / (1 + rate)) : 0);
  }, 0);
  const received = parseFloat(amountReceived) || 0;
  const walletBalance = Number(selectedCustomer?.saldo_monedero ?? 0);
  const walletRedeemValue = paymentMethod === 'monedero_electronico' || (paymentMethod === 'mixto' && mixedMethods.includes('monedero_electronico'))
    ? Math.min(Math.max(0, parseFloat(walletRedeem) || 0), walletBalance, total)
    : 0;
  const mixedAllocated = paymentMethod === 'mixto'
    ? mixedMethods.reduce((sum, method) => sum + (Number(mixedAmounts[method]) || 0), 0)
    : 0;
  const amountDue = paymentMethod === 'mixto' ? Math.max(0, total - mixedAllocated) : Math.max(0, total - walletRedeemValue);
  const change = paymentMethod === 'efectivo' ? Math.max(0, received - amountDue) : 0;
  const changeToWalletValue = saveChangeToWallet ? Math.min(Math.max(0, Number(changeToWallet) || 0), change) : 0;

  const beginRechargeCharge = async (service: RechargeServiceData) => {
    if (!currentBranch || !user || !activeRegister) { setError('Abre un turno antes de cobrar una recarga.'); return; }
    if (cart.length > 0) { setError('La recarga debe cobrarse en una venta separada.'); return; }
    const amount = Number(service.amount);
    if (!Number.isFinite(amount) || amount <= 0) { setError('Selecciona un monto válido para la recarga.'); return; }
    setError(null);
    const { data, error: rechargeError } = await supabase.from('recharge_transactions').insert({ branch_id: currentBranch.id, cash_register_id: activeRegister.id, company: service.company, phone: service.phone, amount }).select('id').maybeSingle();
    if (rechargeError || !data) { console.error(rechargeError); setError('No se pudo preparar la recarga. Intenta nuevamente.'); return; }
    const item: CartItem = { product_id: null, product_name: `Recarga ${service.company} · ${service.phone}`, quantity: 1, unit_price: amount, discount: 0, line_total: amount, stock: Number.POSITIVE_INFINITY, image_url: null, sku: service.reference || null, tax_rate: 0, ieps_rate: 0, bulk: false, presentation_id: null, pieces_per_unit: 1, barcode: null };
    setCart([item]);
    setPendingRecharge(service);
    setRechargeTransactionId(data.id as string);
    setCheckoutOpen(true);
  };

  const saveRechargeOutcome = async (success: boolean, result: RechargeResult, reason: string) => {
    if (!pendingRecharge || !rechargeTransactionId || !currentBranch || !user) return;
    const amount = Number(pendingRecharge.amount);
    const configuredMargin = rechargeMarginType === 'fijo' ? rechargeMarginValue : amount * rechargeMarginValue / 100;
    const margin = Math.min(amount, Math.max(0, configuredMargin));
    const saleStatus = success ? 'completada' : 'cancelada';
    const folio = generateFolio('V');
    const paymentDetails: Record<string, string | boolean | null> = { recharge: true, department_id: rechargeDepartmentId || null, company: pendingRecharge.company, phone: pendingRecharge.phone, provider_folio: result.providerFolio ?? null, provider_reference: result.providerReference ? JSON.stringify(result.providerReference) : null, margin_type: rechargeMarginType, margin_value: String(margin), cancellation_reason: success ? null : reason };
    const { data: saleData, error: saleError } = await supabase.from('sales').insert({ branch_id: currentBranch.id, user_id: user.id, customer_id: selectedCustomer?.id ?? null, cash_register_id: activeRegister?.id ?? null, folio, subtotal: amount, tax: 0, discount: 0, total: amount, payment_method: paymentMethod, payment_details: paymentDetails, amount_received: received, change, status: saleStatus, started_at: new Date().toISOString(), completed_at: success ? new Date().toISOString() : null, canceled_at: success ? null : new Date().toISOString(), canceled_by: success ? null : user.id, cancellation_reason: success ? null : reason }).select().maybeSingle();
    if (saleError || !saleData) { console.error(saleError); setError('No se pudo guardar el resultado de la recarga.'); return; }
    const { error: itemError } = await supabase.from('sale_items').insert({ sale_id: saleData.id, product_id: null, product_name: `Recarga ${pendingRecharge.company} · ${pendingRecharge.phone}`, quantity: 1, unit_price: amount, line_total: amount, discount: 0 });
    if (itemError) { console.error(itemError); setError('No se pudo guardar el detalle de la recarga.'); return; }
    const { error: transactionError } = await supabase.from('recharge_transactions').update({ status: success ? 'exitosa' : 'anulada', provider_folio: result.providerFolio ?? null, provider_reference: result.providerReference ?? {}, sale_id: saleData.id, failure_reason: success ? null : reason, confirmed_at: new Date().toISOString() }).eq('id', rechargeTransactionId);
    if (transactionError) { console.error(transactionError); setError('La recarga se guardó, pero no se pudo actualizar su seguimiento.'); return; }
    if (success) {
      const ticketData: TicketData = { branch: currentBranch, logoUrl: PROGRAM_LOGO, ticketWidth, storeName: currentBranch.name, folio, createdAt: new Date().toLocaleString('es-MX'), customerName: selectedCustomer?.name ?? 'Público en General', items: [{ product_name: `Recarga ${pendingRecharge.company}`, sku: pendingRecharge.phone, barcode: null, quantity: 1, unit_price: amount, line_total: amount }], subtotal: amount, tax: 0, discount: 0, total: amount, paymentMethod, amountReceived: received, change, currencySymbol, sellerName: profile?.full_name ?? 'Vendedor', paymentDetails };
      setLastSale(ticketData);
      void printTicket(ticketData);
      setQrUrl('');
      generateQrDataUrl(buildTicketText(ticketData)).then((url) => setQrUrl(url));
    }
    setRechargeConfirmation(null);
    setPendingRecharge(null);
    setRechargeTransactionId(null);
    setExecuteRecharge(null);
    setProcessing(false);
    setCheckoutOpen(false);
    clearCart();
    if (!success) setError('La recarga quedó anulada y se registró la causa.');
  };

  const handleRechargeResult = (result: RechargeResult) => {
    if (!pendingRecharge) return;
    setExecuteRecharge(null);
    setProcessing(false);
    setRechargeConfirmation({ result, reason: '' });
  };

  const lookupWalletCustomer = async () => {
    const phone = walletPhone.trim();
    if (!/^\d{10}$/.test(phone)) { setWalletError('Escribe un teléfono de 10 dígitos.'); return; }
    setWalletLookupBusy(true);
    setWalletError(null);
    const { data, error } = await supabase.from('customers').select('*').eq('phone', phone).maybeSingle();
    setWalletLookupBusy(false);
    if (error) { console.error(error); setWalletError('No se pudo buscar el cliente. Intenta de nuevo.'); return; }
    if (!data) { setWalletError('No hay ningún cliente con ese teléfono.'); return; }
    const found = data as Customer;
    setSelectedCustomer(found);
    setSendPhone(found.phone ?? '');
    setSendEmail(found.email ?? '');
    setWalletRedeem('');
    setSaveChangeToWallet(false);
    setWalletPhone('');
  };

  const attemptSale = async () => {
    const usesWallet = paymentMethod === 'monedero_electronico' || (paymentMethod === 'mixto' && mixedMethods.includes('monedero_electronico'));
    if (usesWallet && walletRedeemValue > 0) {
      if (!selectedCustomer?.email) {
        setError('El cliente no tiene correo electrónico. No se puede enviar el PIN de autorización.');
        return;
      }
      setError(null);
      setWalletPinSending(true);
      setWalletPinError(null);
      setWalletPinCode('');
      setWalletVerificationId(null);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const sessionToken = sessionData?.session?.access_token;
        if (!sessionToken) { setError('Sesión no válida.'); setWalletPinSending(false); return; }
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-authorization-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
          body: JSON.stringify({
            action: 'send',
            to: selectedCustomer.email,
            customerName: selectedCustomer.name,
            amount: formatCurrency(walletRedeemValue, currencySymbol),
            purpose: 'autorización de compra con monedero',
            storeName: currentBranch?.name ?? 'Tienda',
            logoUrl: `${window.location.origin}${PROGRAM_LOGO}`,
          }),
        });
        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error ?? 'No se pudo enviar el PIN');
        }
        const json = await res.json() as { verificationId?: string };
        setWalletVerificationId(json.verificationId ?? null);
        setWalletPinOpen(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'No se pudo enviar el PIN';
        setError(msg);
      } finally {
        setWalletPinSending(false);
      }
      return;
    }
    void completeSale();
  };

  const verifyPinAndComplete = async () => {
    if (!walletVerificationId || !walletPinCode.trim()) { setWalletPinError('Escribe el PIN de 6 dígitos.'); return; }
    setWalletPinVerifying(true);
    setWalletPinError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const sessionToken = sessionData?.session?.access_token;
      if (!sessionToken) { setWalletPinError('Sesión no válida.'); setWalletPinVerifying(false); return; }
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-authorization-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
        body: JSON.stringify({ action: 'verify', verificationId: walletVerificationId, pin: walletPinCode.trim() }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.error ?? 'PIN incorrecto');
      }
      setWalletPinOpen(false);
      setWalletPinCode('');
      setWalletVerificationId(null);
      void completeSale();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'PIN incorrecto';
      setWalletPinError(msg);
    } finally {
      setWalletPinVerifying(false);
    }
  };

  const completeSale = async () => {
    if (!currentBranch || !user) return;
    if (cart.length === 0) return;
    if (paymentMethod === 'efectivo' && received < amountDue) {
      setError('El monto recibido es menor al total');
      return;
    }
    const requestedChangeToWallet = Number(changeToWallet) || 0;
    if (saveChangeToWallet && (requestedChangeToWallet <= 0 || requestedChangeToWallet > change)) {
      setError('Indica un monto válido, igual o menor al cambio disponible.');
      return;
    }
    if (paymentMethod === 'monedero_electronico' && (!selectedCustomer || walletRedeemValue < total)) {
      setError('Selecciona un cliente con saldo suficiente y usa el saldo necesario para cubrir la venta.');
      return;
    }
    if (paymentMethod === 'mixto') {
      if (mixedMethods.length < 2 || Math.abs(mixedAllocated - total) > 0.01) {
        setError('Selecciona al menos dos métodos y distribuye exactamente el total de la venta.');
        return;
      }
      if (mixedMethods.includes('monedero_electronico') && (!selectedCustomer || walletRedeemValue <= 0 || walletRedeemValue > walletBalance)) {
        setError('El pago mixto con monedero requiere un cliente con saldo suficiente.');
        return;
      }
      if (mixedMethods.includes('efectivo') && (Number(mixedAmounts.efectivo) || 0) <= 0) {
        setError('Indica el importe en efectivo del pago mixto.');
        return;
      }
    }

    const paymentDetails: Record<string, string | boolean | null> = {};
    if (paymentMethod === 'monedero_electronico') {
      paymentDetails.wallet_redeemed = String(walletRedeemValue);
      paymentDetails.wallet_customer = selectedCustomer?.name ?? null;
    }
    if (paymentMethod === 'mixto') {
      paymentDetails.mixed_payments = JSON.stringify(mixedMethods.map((method) => ({ method, amount: Number(mixedAmounts[method]) || 0 })));
    }
    if (paymentMethod === 'tarjeta' || (paymentMethod === 'mixto' && mixedMethods.includes('tarjeta'))) {
      if (!cardLast4.match(/^\d{4}$/) || !cardBank.trim() || !authorizationNumber.trim()) {
        setError('Completa los datos de la tarjeta y la autorización.');
        return;
      }
      if (nipMode === 'sin_nip' && (!noNipName.trim() || !noNipAddress.trim() || !noNipPhone.trim())) {
        setError('Completa los datos del cliente cuando el pago es sin NIP.');
        return;
      }
      paymentDetails.card_type = cardType;
      paymentDetails.card_last4 = cardLast4;
      paymentDetails.card_bank = cardBank.trim();
      paymentDetails.authorization_number = authorizationNumber.trim();
      paymentDetails.nip_mode = nipMode;
      paymentDetails.customer_name = nipMode === 'sin_nip' ? noNipName.trim() : null;
      paymentDetails.customer_address = nipMode === 'sin_nip' ? noNipAddress.trim() : null;
      paymentDetails.customer_phone = nipMode === 'sin_nip' ? noNipPhone.trim() : null;
      paymentDetails.ticket_signed = nipMode === 'sin_nip' ? ticketSigned === 'si' : null;
    }
    if (paymentMethod === 'transferencia' || (paymentMethod === 'mixto' && mixedMethods.includes('transferencia'))) {
      if (!selectedBankAccount || !transferOriginBank.trim() || !transferConcept.trim() || !transferOriginAccount.trim() || !transferReceipt) {
        setError('Completa los datos y adjunta el comprobante de transferencia.');
        return;
      }
      if (transferReceipt.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png', 'application/pdf'].includes(transferReceipt.type)) {
        setError('El comprobante debe ser JPG, PNG o PDF de máximo 5 MB.');
        return;
      }
      setProcessing(true);
      const receiptPath = `${user.id}/${crypto.randomUUID()}-${transferReceipt.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error: uploadError } = await supabase.storage.from('payment-receipts').upload(receiptPath, transferReceipt, { contentType: transferReceipt.type, upsert: false });
      if (uploadError) {
        setError('No se pudo guardar el comprobante.');
        setProcessing(false);
        return;
      }
      paymentDetails.receiving_bank_account_id = selectedBankAccount.id;
      paymentDetails.receiving_bank_name = selectedBankAccount.bank_name;
      paymentDetails.transfer_origin_bank = transferOriginBank.trim();
      paymentDetails.transfer_concept = transferConcept.trim();
      paymentDetails.transfer_origin_account = transferOriginAccount.trim();
      paymentDetails.receipt_path = receiptPath;
    }

    setProcessing(true);
    setError(null);
    if (pendingRecharge) {
      setCheckoutOpen(false);
      setExecuteRecharge({ ...pendingRecharge });
      return;
    }
    const folio = generateFolio('V');
    const { data: saleData, error: saleErr } = await supabase
      .from('sales')
      .insert({
        branch_id: currentBranch.id,
        user_id: user.id,
        customer_id: selectedCustomer?.id ?? null,
        cash_register_id: activeRegister?.id ?? null,
        folio,
        subtotal,
        tax,
        discount: discountVal,
        total,
        payment_method: paymentMethod,
        payment_details: paymentDetails,
        amount_received: paymentMethod === 'mixto' ? mixedAllocated : (paymentMethod === 'monedero_electronico' ? walletRedeemValue : received),
        change,
        status: 'completada',
        started_at: saleStartedAt ? new Date(saleStartedAt).toISOString() : new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (saleErr) { console.error(saleErr); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); setProcessing(false); return; }

    const items = cart.map((i) => ({
      sale_id: saleData.id,
      product_id: i.product_id,
      presentation_id: i.presentation_id,
      product_name: i.product_name,
      quantity: i.quantity * i.pieces_per_unit,
      unit_price: i.pieces_per_unit === 1 ? i.unit_price : Number((i.unit_price / i.pieces_per_unit).toFixed(4)),
      discount: i.discount ?? 0,
      line_total: i.line_total,
    }));
    const { error: itemsErr } = await supabase.from('sale_items').insert(items);
    if (itemsErr) { console.error(itemsErr); setError('No se pudo completar la operación. Revisa los datos e intenta de nuevo.'); setProcessing(false); return; }

    let walletResult: WalletSaleResult | null = null;
    if (selectedCustomer) {
      const { data: walletData, error: walletErr } = await supabase.rpc('apply_wallet_sale', {
        p_sale_id: saleData.id,
        p_redeem: walletRedeemValue,
        p_change_to_wallet: changeToWalletValue,
      });
      if (walletErr || !walletData) {
        console.error(walletErr);
        await supabase.from('sales').update({ status: 'cancelada', canceled_at: new Date().toISOString(), canceled_by: user.id, cancellation_reason: 'Error al aplicar monedero' }).eq('id', saleData.id);
        setError('No se pudo aplicar el monedero. La venta no se completó; intenta de nuevo.');
        setProcessing(false);
        return;
      }
      walletResult = walletData as WalletSaleResult;
    }

    // Decrement stock
    for (const item of cart) {
      const newQty = Math.max(0, (stockMap.get(item.product_id!) ?? 0) - item.quantity * item.pieces_per_unit);
      await supabase
        .from('product_stock')
        .update({ quantity: newQty })
        .eq('product_id', item.product_id)
        .eq('branch_id', currentBranch.id);
    }

    const ticketData: TicketData = { branch: currentBranch, logoUrl: PROGRAM_LOGO, ticketWidth, storeName: currentBranch.name, folio, createdAt: new Date().toLocaleString('es-MX'), customerName: selectedCustomer?.name ?? 'Público en General', items: cart.map((item) => ({ product_name: item.product_name, sku: item.sku, barcode: item.barcode, quantity: item.quantity, unit_price: item.unit_price, line_total: item.line_total })), subtotal, tax, discount: discountVal, total, paymentMethod, amountReceived: paymentMethod === 'mixto' ? mixedAllocated : paymentMethod === 'monedero_electronico' ? walletRedeemValue : received, change, currencySymbol, sellerName: profile?.full_name ?? 'Vendedor', paymentDetails, wallet: walletResult };
    setLastSale(ticketData);
    setSaleStartedAt(null);
    setSaleElapsed(0);
    setQrUrl('');
    generateQrDataUrl(buildTicketText(ticketData)).then((url) => setQrUrl(url));
    setProcessing(false);
    setCheckoutOpen(false);
    clearCart();
    loadProducts();
  };

  const availablePaymentMethods = PAYMENT_METHODS.filter(
    (method) => !method.requiresCustomer || selectedCustomer
  );

  const clearSelectedCustomer = () => {
    setSelectedCustomer(null);
    setWalletRedeem('');
    setSaveChangeToWallet(false);
    setChangeToWallet('');
    if (paymentMethod === 'credito') {
      setPaymentMethod('efectivo');
    }
  };

  const generateCustomerCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return `CLI-${code}`;
  };

  const saveQuickCustomer = async () => {
    setNcError(null);
    if (!ncName.trim()) { setNcError('El nombre es obligatorio'); return; }
    if (!ncPaterno.trim()) { setNcError('El apellido paterno es obligatorio'); return; }
    if (ncPhone.replace(/\D/g, '').length !== 10) { setNcError('El teléfono debe tener 10 dígitos'); return; }
    if (!ncCalle.trim() || !ncNumero.trim() || !ncColonia.trim() || !ncMunicipio.trim()) {
      setNcError('Calle, número, colonia y municipio son obligatorios'); return;
    }
    setNcSaving(true);
    const fullName = `${ncName.trim()} ${ncPaterno.trim()}${ncMaterno.trim() ? ' ' + ncMaterno.trim() : ''}`;
    const fullAddress = `${ncCalle.trim()} ${ncNumero.trim()}, ${ncColonia.trim()}${ncPoblacion.trim() ? ', ' + ncPoblacion.trim() : ''}, ${ncMunicipio.trim()}`;
    const code = generateCustomerCode();
    const { data, error: insErr } = await supabase.from('customers').insert({
      name: fullName,
      codigo_cliente: code,
      paterno: ncPaterno.trim(),
      materno: ncMaterno.trim() || null,
      phone: ncPhone.replace(/\D/g, ''),
      address: fullAddress,
      calle: ncCalle.trim(),
      numero_ext: ncNumero.trim(),
      colonia: ncColonia.trim(),
      poblacion: ncPoblacion.trim() || null,
      municipio: ncMunicipio.trim(),
    }).select().maybeSingle();
    if (insErr) {
      console.error(insErr);
      setNcError(insErr.code === '23505'
        ? 'Ya existe un cliente con ese teléfono. Verifica el número.'
        : 'No se pudo registrar el cliente. Verifica los datos.');
      setNcSaving(false);
      return;
    }
    const created = data as Customer;
    setCustomers((prev) => [...prev, created]);
    setSelectedCustomer(created);
    setSendPhone(created.phone ?? '');
    setNcName(''); setNcPaterno(''); setNcMaterno(''); setNcPhone('');
    setNcCalle(''); setNcNumero(''); setNcColonia(''); setNcPoblacion(''); setNcMunicipio('');
    setNcSaving(false); setNewCustomerOpen(false); setCustomerSearchOpen(false);
  };

  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase())
  );

  return (
    <div className="pos-layout flex h-full flex-col">
      {/* Top bar: always accessible buttons */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex items-center gap-2">
          {activeRegister ? (
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">Turno: {activeRegister.folio}</span>
          ) : (
            <span className="rounded-lg bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">Sin turno abierto</span>
          )}
          {saleStartedAt && <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-xs font-bold text-emerald-700">Venta {formatSaleElapsed(saleElapsed)}</span>}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setNewSaleOpen(true)} className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700"><Plus size={16} /> Nueva venta <span className="hidden sm:inline">ESC</span></button>
          {subMenu.priceButton}
          {subMenu.menuButton}
        </div>
      </div>

      <div className={`flex flex-1 overflow-hidden ${mode === 'vertical' ? 'pos-layout-vertical' : 'lg:flex-row'}`}>
      {/* Left: Sale */}
      <div className="pos-sale-panel relative flex w-full flex-col border-r border-slate-200 bg-white lg:w-1/2">
        <ExtensionBridgeTest onChargeRequest={beginRechargeCharge} executeRecharge={executeRecharge} onRechargeResult={handleRechargeResult} />
        {newSaleOpen && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-white/95 p-6">
            <div className="w-full max-w-sm space-y-4 text-center">
              <div className="rounded-xl border border-emerald-100 bg-emerald-50 p-5"><Plus size={32} className="mx-auto mb-2 text-emerald-600" /><p className="font-semibold text-slate-800">¿Deseas iniciar una nueva venta?</p><p className="mt-1 text-sm text-slate-600">El cronómetro comenzará al aceptar.</p></div>
              <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setNewSaleOpen(false)}>Cancelar</Button><Button onClick={startNewSale}>Iniciar venta</Button></div>
            </div>
          </div>
        )}
        <div className="border-b border-slate-200 p-4">
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50/60 px-3 py-2">
            <button
              onClick={() => { setCustomerSearch(''); setCustomerSearchOpen(true); }}
              className="flex flex-1 items-center gap-2 rounded-lg bg-white px-3 py-2 text-left shadow-sm transition hover:bg-emerald-50"
            >
              <UserPlus size={16} className="flex-shrink-0 text-emerald-600" />
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Cliente</span>
                <span className="flex items-center gap-2">
                  <span className="block truncate text-sm font-semibold text-slate-700">{selectedCustomer?.name ?? 'Público en General'}</span>
                  {selectedCustomer && Number(selectedCustomer.saldo_monedero) > 0 && (
                    <span className="flex-shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">Monedero: {formatCurrency(selectedCustomer.saldo_monedero, currencySymbol)}</span>
                  )}
                </span>
              </span>
            </button>
          </div>

          <div className="relative">
            <ScanLine size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-blue-600" />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => {
                const value = e.target.value;
                setSearch(value);
                setScanAlert(null);
                if (scanTimerRef.current !== null) window.clearTimeout(scanTimerRef.current);
                if (/^\d{8,14}$/.test(value)) {
                  scanTimerRef.current = window.setTimeout(() => { void handleScan(value); }, 90);
                }
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleScan(); } }}
              placeholder="Escanea un código o busca un producto..."
              className="w-full rounded-lg border border-slate-300 py-3 pl-10 pr-12 text-sm text-slate-800 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition"
            />
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              title="Escanear con la cámara"
              aria-label="Escanear con la cámara"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md bg-blue-600 p-1.5 text-white transition hover:bg-blue-700"
            >
              <ScanLine size={18} />
            </button>
          </div>

          {/* Alerta de escaneo */}
          {scanAlert && (
            <div className="mt-3 flex items-center gap-2 rounded-lg border-2 border-red-500 bg-red-50 px-4 py-3 text-red-700 animate-pulse">
              <AlertTriangle size={20} className="flex-shrink-0 text-red-600" />
              <span className="text-sm font-bold">{scanAlert}</span>
              <button
                onClick={() => setScanAlert(null)}
                className="ml-auto rounded p-1 text-red-500 hover:bg-red-100"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {search.trim() && (
            <div className="relative z-20">
              <div className="absolute left-0 right-0 top-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Productos encontrados ({searchEntries.length})
                </div>
                {searchEntries.slice(0, 8).map(({ key, product: p, presentation }) => {
                  const stock = getAvailableStock(p) - (presentation ? piecesInCart(cart, p.id) : 0);
                  const unavailable = p.track_inventory && !canSellWithoutStock && (presentation ? stock < presentation.pieces : stock <= 0);
                  return (
                    <button
                      key={key}
                      onClick={() => { addToCart(p, undefined, presentation); setSearch(''); }}
                      disabled={unavailable}
                      className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left transition last:border-0 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                        {(presentation?.image_url ?? p.image_url) ? (
                          <img src={presentation?.image_url ?? p.image_url ?? undefined} alt={p.name} className="h-full w-full object-cover" />
                        ) : (
                          <ImageIcon size={16} className="text-slate-400" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-slate-800">{presentation ? `${p.name} · ${presentation.name}` : p.name}</div>
                        <div className="text-xs text-slate-500">{presentation ? `Código: ${presentation.code} · ${presentation.pieces} pz` : `SKU: ${p.sku ?? 'Sin código'} · Stock: ${p.track_inventory ? stock : 'Sin control'}`}</div>
                      </div>
                      <div className="text-sm font-bold text-emerald-600">{formatCurrency(presentation ? presentation.sale_price : p.sale_price, currencySymbol)}</div>
                    </button>
                  );
                })}
                {searchEntries.length === 0 && (
                  <div className="px-3 py-4 text-center text-sm text-slate-500">No se encontraron productos</div>
                )}
                {searchEntries.length > 8 && (
                  <div className="border-t border-slate-100 px-3 py-2 text-center text-xs text-slate-400">Escribe más para ver resultados precisos</div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Cart */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
              <ShoppingCart size={16} /> Carrito ({cart.length})
            </h2>
            {cart.length > 0 && (
              <button onClick={clearCart} className="text-xs text-red-600 hover:underline">
                Vaciar
              </button>
            )}
          </div>
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
              <ShoppingCart size={40} className="mb-2" />
              <p className="text-sm">Agrega productos al carrito</p>
            </div>
          ) : (
            <div className="space-y-2">
              {cart.map((item) => (
                <div key={cartLineKey(item)} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-100">
                      {item.image_url ? <img src={item.image_url} alt={item.product_name} className="h-full w-full object-cover" /> : <ImageIcon size={16} className="text-slate-400" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-800">{item.product_name}</div>
                      <div className="truncate text-[11px] text-slate-500">{item.sku ?? 'Sin código'} · {formatCurrency(item.unit_price, currencySymbol)} · Stock: {Number.isFinite(item.stock) ? item.stock : 'Sin control'}</div>
                    </div>
                    <div className="text-right text-sm font-bold text-slate-800">{formatCurrency(item.line_total, currencySymbol)}</div>
                    <button
                      onClick={() => removeItem(cartLineKey(item))}
                      className="text-slate-400 hover:text-red-600"
                      aria-label={`Eliminar ${item.product_name}`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-col gap-2 border-t border-slate-100 pt-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => changeQty(cartLineKey(item), -1)}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                      >
                        <Minus size={14} />
                      </button>
                      <span className="w-8 text-center text-sm font-semibold">{item.quantity}</span>
                      <button
                        onClick={() => changeQty(cartLineKey(item), 1)}
                        disabled={item.quantity >= item.stock && !canSellWithoutStock}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs text-slate-500">
                      Desc
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        value={item.discount ?? 0}
                        onChange={(e) => updateItemDiscount(cartLineKey(item), e.target.value)}
                        className="h-8 w-16 rounded-md border border-slate-200 px-2 text-center text-xs text-slate-800 focus:border-blue-500 focus:outline-none"
                        aria-label={`Descuento para ${item.product_name}`}
                      />
                      %
                    </label>
                    <div className="ml-auto text-right">
                      <div className="text-[10px] uppercase text-slate-400">Subtotal</div>
                      <div className="text-sm font-bold text-slate-800">{formatCurrency(item.line_total, currencySymbol)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Totals */}
        <div className="border-t border-slate-200 bg-slate-50 p-4">
          <div className="space-y-1.5 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span className="font-medium">{formatCurrency(subtotal, currencySymbol)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>Descuento</span>
              <span className="font-medium">{formatCurrency(discountVal, currencySymbol)}</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-bold text-slate-800">
              <span>Total</span>
              <span className="text-emerald-600">{formatCurrency(total, currencySymbol)}</span>
            </div>
          </div>
          {activeRegister ? (
            <Button
              className="mt-3 w-full"
              size="lg"
              disabled={cart.length === 0}
              onClick={() => setCheckoutOpen(true)}
            >
              Cobrar · {formatCurrency(total, currencySymbol)}
            </Button>
          ) : (
            <Button
              className="mt-3 w-full"
              size="lg"
              variant="secondary"
              disabled
            >
              <Lock size={16} /> Abre un turno para vender
            </Button>
          )}
        </div>
      </div>

      {/* Right: Ads */}
      <div className="pos-ads-panel hidden w-1/2 bg-white lg:flex flex-col">
        {ads.length > 0 ? (
          <div className="relative flex-1 overflow-hidden bg-white">
            {ads.map((ad, i) => (
              <div
                key={ad.id}
                className={`absolute inset-0 transition-opacity duration-1000 ${
                  i === adIndex ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <img src={ad.image_url} alt={ad.title} className="h-full w-full object-contain bg-white p-4 sm:p-6" />
                <div className="absolute bottom-0 left-0 right-0 bg-white/90 px-6 py-4 backdrop-blur-sm">
                  <h3 className="text-2xl font-bold text-slate-800">{ad.title}</h3>
                </div>
              </div>
            ))}
            {ads.length > 1 && (
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2 rounded-full bg-white/90 px-3 py-2 shadow-sm">
                {ads.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setAdIndex(i)}
                    aria-label={`Mostrar publicidad ${i + 1}`}
                    className={`h-2 rounded-full transition-all ${
                      i === adIndex ? 'w-8 bg-emerald-600' : 'w-2 bg-slate-300'
                    }`}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-slate-500">
            <ImageIcon size={56} className="mb-3" />
            <p className="text-sm">Sin imágenes publicitarias</p>
            <p className="text-xs text-slate-600 mt-1">Añádelas desde Configuración</p>
          </div>
        )}
        {/* Quick stats */}
        <div className="border-t border-emerald-100 bg-white p-4 text-center">
          <p className="text-xs text-slate-500">Operando en</p>
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">{currentBranch?.name ?? 'BIENESTAR'}</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Versión actual: VERSION-LEAL-2601</p>
        </div>
      </div>

      {/* Bulk quantity modal */}
      <Modal open={bulkProduct !== null} onClose={() => setBulkProduct(null)} title="Cantidad a granel" size="md">
        {bulkProduct && (
          <div className="space-y-4">
            <div className="flex items-center gap-4 rounded-xl border border-blue-100 bg-blue-50/60 p-4">
              <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
                {bulkProduct.image_url ? <img src={bulkProduct.image_url} alt={bulkProduct.name} className="h-full w-full object-cover" /> : <ImageIcon size={28} className="text-slate-400" />}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Venta a granel</div>
                <div className="truncate text-lg font-bold text-slate-800">{bulkProduct.name}</div>
                <div className="text-sm text-slate-500">Código: {bulkProduct.barcode ?? bulkProduct.sku ?? 'Sin código'}</div>
                <div className="mt-1 text-sm font-semibold text-slate-700">Precio por {bulkProduct.unit || 'unidad'}: {formatCurrency(Number(bulkProduct.sale_price), currencySymbol)}</div>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Cantidad (${bulkProduct.unit || 'kg'})`}>
                <Input type="number" min="0.001" step="0.001" value={bulkQuantity} onChange={(e) => { const value = e.target.value; setBulkQuantity(value); const quantity = Number(value); if (Number.isFinite(quantity)) setBulkAmount((quantity * Number(bulkProduct.sale_price)).toFixed(2)); }} autoFocus />
              </Field>
              <Field label="Importe total">
                <Input type="number" min="0.01" step="0.01" value={bulkAmount} onChange={(e) => { const value = e.target.value; setBulkAmount(value); const amount = Number(value); if (Number.isFinite(amount)) setBulkQuantity((amount / Number(bulkProduct.sale_price)).toFixed(3)); }} />
              </Field>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-4 py-3 text-sm">
              <span className="text-slate-600">Cantidad a agregar</span>
              <span className="font-bold text-emerald-700">{Number(bulkQuantity || 0).toFixed(3)} {bulkProduct.unit || 'kg'} · {formatCurrency(Number(bulkAmount || 0), currencySymbol)}</span>
            </div>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setBulkProduct(null)}>Cancelar</Button><Button onClick={addBulkToCart}>Aceptar y agregar</Button></div>
          </div>
        )}
      </Modal>

      {/* Checkout modal */}
      <Modal open={checkoutOpen} onClose={() => setCheckoutOpen(false)} title="Cobro de venta" size="md">
        <div className="space-y-4">
          <div className="rounded-lg bg-emerald-50 p-4 text-center">
            <div className="text-sm text-slate-600">Total a pagar</div>
            <div className="text-3xl font-bold text-emerald-600">{formatCurrency(total, currencySymbol)}</div>
          </div>

          <Field label="Método de pago">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {availablePaymentMethods.map((m) => (
                <button
                  key={m.value}
                  onClick={() => setPaymentMethod(m.value)}
                  className={`flex items-center justify-center gap-2 rounded-lg border py-2.5 text-sm font-medium transition ${
                    paymentMethod === m.value
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {m.icon} {m.label}
                </button>
              ))}
            </div>
          </Field>

          {(paymentMethod === 'monedero_electronico' || paymentMethod === 'mixto') && <div className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><WalletCards size={17} /> Monedero y puntos</div>
            {selectedCustomer ? (
              <>
                <div className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-800">{selectedCustomer.name}</div>
                    <div className="text-xs text-slate-500">Tel. {selectedCustomer.phone ?? 'Sin teléfono'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Saldo</div>
                    <div className="font-bold text-emerald-700">{formatCurrency(walletBalance, currencySymbol)}</div>
                  </div>
                </div>
                {walletBalance > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-end gap-2">
                      <div className="flex-1">
                        <Field label="Pagar con monedero">
                          <Input type="number" min={0} step="0.01" value={walletRedeem} onChange={(e) => setWalletRedeem(e.target.value)} placeholder="0.00" />
                        </Field>
                      </div>
                      <Button variant="secondary" onClick={() => setWalletRedeem(String(Math.min(walletBalance, total)))}>Usar todo</Button>
                    </div>
                    {walletRedeemValue > 0 && (
                      <div className="flex justify-between rounded-lg bg-white px-3 py-2 text-sm">
                        <span className="text-slate-600">Restante a pagar</span>
                        <span className="font-bold text-slate-800">{formatCurrency(amountDue, currencySymbol)}</span>
                      </div>
                    )}
                  </div>
                )}
                <button type="button" onClick={clearSelectedCustomer} className="text-xs text-red-600 hover:underline">Quitar cliente</button>
              </>
            ) : (
              <>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      inputMode="numeric"
                      maxLength={10}
                      value={walletPhone}
                      onChange={(e) => setWalletPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookupWalletCustomer(); } }}
                      placeholder="Teléfono de 10 dígitos"
                    />
                  </div>
                  <Button variant="secondary" disabled={walletLookupBusy} onClick={() => void lookupWalletCustomer()}>{walletLookupBusy ? 'Buscando...' : 'Buscar'}</Button>
                </div>
                {walletError && <p className="text-xs text-red-600">{walletError}</p>}
              </>
            )}
          </div>}

          {paymentMethod === 'mixto' && (
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
              <div className="text-sm font-semibold text-slate-700">Selecciona los métodos que usarás</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {PAYMENT_METHODS.filter((method) => !['mixto', 'credito'].includes(method.value)).map((method) => {
                  const checked = mixedMethods.includes(method.value);
                  return <button key={method.value} type="button" onClick={() => setMixedMethods((current) => checked ? current.filter((value) => value !== method.value) : [...current, method.value])} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-medium ${checked ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-white text-slate-600'}`}>{method.icon} {method.label}</button>;
                })}
              </div>
              {mixedMethods.map((method) => <Field key={method} label={`Importe ${PAYMENT_METHODS.find((item) => item.value === method)?.label ?? method}`}><Input type="number" min={0} step="0.01" value={method === 'monedero_electronico' ? walletRedeem : (mixedAmounts[method] ?? '')} onChange={(e) => method === 'monedero_electronico' ? setWalletRedeem(e.target.value) : setMixedAmounts((current) => ({ ...current, [method]: e.target.value }))} /></Field>)}
              <div className="flex justify-between rounded-lg bg-white px-3 py-2 text-sm"><span className="text-slate-600">Distribuido</span><span className={`font-bold ${Math.abs(mixedAllocated - total) < 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>{formatCurrency(mixedAllocated, currencySymbol)} de {formatCurrency(total, currencySymbol)}</span></div>
            </div>
          )}

          {paymentMethod === 'tarjeta' || (paymentMethod === 'mixto' && mixedMethods.includes('tarjeta')) ? (
            <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#0b347d]"><CreditCard size={17} /> Datos de tarjeta</div>
              <div className="grid grid-cols-2 gap-2">
                {(['debito', 'credito'] as const).map((type) => (
                  <button key={type} type="button" onClick={() => setCardType(type)} className={`rounded-lg border px-3 py-2 text-sm font-medium ${cardType === type ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>
                    {type === 'debito' ? 'Débito' : 'Crédito'}
                  </button>
                ))}
              </div>
              <Field label="Número de tarjeta · XXXX XXXX XXXX ____">
                <Input value={cardLast4} onChange={(e) => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" maxLength={4} placeholder="1234" />
              </Field>
              <Field label="Banco"><Input value={cardBank} onChange={(e) => setCardBank(e.target.value)} placeholder="Nombre del banco" /></Field>
              <Field label="Número de autorización"><Input value={authorizationNumber} onChange={(e) => setAuthorizationNumber(e.target.value)} /></Field>
              <Field label="Autorizado con NIP">
                <Select value={nipMode} onChange={(e) => setNipMode(e.target.value as 'con_nip' | 'sin_nip')}>
                  <option value="con_nip">Sí, con NIP</option><option value="sin_nip">No, sin NIP</option>
                </Select>
              </Field>
              {nipMode === 'sin_nip' && (
                <div className="space-y-3 border-t border-blue-100 pt-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Datos del cliente que pagó</div>
                  <Field label="Nombre"><Input value={noNipName} onChange={(e) => setNoNipName(e.target.value)} /></Field>
                  <Field label="Domicilio"><Input value={noNipAddress} onChange={(e) => setNoNipAddress(e.target.value)} /></Field>
                  <Field label="Teléfono"><Input value={noNipPhone} onChange={(e) => setNoNipPhone(e.target.value)} /></Field>
                  <Field label="¿Firmó el ticket?">
                    <Select value={ticketSigned} onChange={(e) => setTicketSigned(e.target.value as 'si' | 'no')}><option value="si">Sí</option><option value="no">No</option></Select>
                  </Field>
                </div>
              )}
            </div>
          ) : null}

          {paymentMethod === 'transferencia' || (paymentMethod === 'mixto' && mixedMethods.includes('transferencia')) ? (
            <div className="space-y-3 rounded-xl border border-cyan-100 bg-cyan-50/50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-cyan-800"><Landmark size={17} /> Cuenta receptora</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {bankAccounts.map((account) => (
                  <button key={account.id} type="button" onClick={() => setSelectedBankAccount(account)} className={`rounded-lg border bg-white p-3 text-left transition ${selectedBankAccount?.id === account.id ? 'border-cyan-600 ring-2 ring-cyan-100' : 'border-slate-200 hover:border-cyan-300'}`}>
                    <div className="flex items-center gap-2">
                      {account.logo_url ? <img src={account.logo_url} alt="" className="h-8 w-8 rounded object-contain" /> : <Building2 size={22} className="text-cyan-700" />}
                      <span className="font-semibold text-slate-800">{account.bank_name}</span>
                    </div>
                    <div className="mt-2 space-y-0.5 text-xs text-slate-500"><div>Beneficiario: {account.beneficiary}</div><div>Cuenta: {account.account_number}</div><div>CLABE: {account.clabe}</div></div>
                  </button>
                ))}
              </div>
              {bankAccounts.length === 0 && <div className="rounded-lg bg-white p-3 text-sm text-slate-500">No hay cuentas receptoras activas configuradas.</div>}
              <Field label="Banco de origen"><Input value={transferOriginBank} onChange={(e) => setTransferOriginBank(e.target.value)} /></Field>
              <Field label="Concepto"><Input value={transferConcept} onChange={(e) => setTransferConcept(e.target.value)} /></Field>
              <Field label="Cuenta de origen"><Input value={transferOriginAccount} onChange={(e) => setTransferOriginAccount(e.target.value)} /></Field>
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-cyan-300 bg-white px-3 py-3 text-sm text-slate-600 hover:bg-cyan-50">
                <Upload size={17} className="text-cyan-700" />
                <span>{transferReceipt ? transferReceipt.name : 'Adjuntar comprobante (JPG, PNG o PDF)'}</span>
                <input type="file" accept="image/jpeg,image/png,application/pdf" className="sr-only" onChange={(e) => setTransferReceipt(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          ) : null}

          {(paymentMethod === 'efectivo' || (paymentMethod === 'mixto' && mixedMethods.includes('efectivo'))) && (
            <Field label={paymentMethod === 'mixto' ? 'Importe en efectivo' : 'Monto recibido'}>
              <Input
                id="pos-amount-received"
                type="number"
                value={paymentMethod === 'mixto' ? (mixedAmounts.efectivo ?? '') : amountReceived}
                onChange={(e) => paymentMethod === 'mixto' ? setMixedAmounts((current) => ({ ...current, efectivo: e.target.value })) : setAmountReceived(e.target.value)}
                placeholder="0.00"
                min={0}
                step="0.01"
              />
            </Field>
          )}

          {paymentMethod === 'efectivo' && received > 0 && (
            <div className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="text-slate-600">Cambio</span>
              <span className="font-bold text-slate-800">{formatCurrency(change, currencySymbol)}</span>
            </div>
          )}

          {paymentMethod === 'efectivo' && change > 0 && selectedCustomer && (
            <div className="flex items-center justify-between gap-2 px-1 text-xs text-slate-500">
              {saveChangeToWallet ? (
                <>
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <WalletCards size={14} className="shrink-0 text-emerald-600" />
                    <span className="whitespace-nowrap">Enviar al monedero</span>
                    <Input
                      type="number"
                      min={0.01}
                      max={change}
                      step="0.01"
                      value={changeToWallet}
                      onChange={(event) => setChangeToWallet(event.target.value)}
                      className="h-8 min-w-0 flex-1 text-right text-sm"
                      placeholder="0.00"
                    />
                    <span className="whitespace-nowrap">de {formatCurrency(change, currencySymbol)}</span>
                  </label>
                  <button type="button" onClick={() => { setSaveChangeToWallet(false); setChangeToWallet(''); }} className="shrink-0 text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline">Cancelar</button>
                </>
              ) : (
                <button type="button" onClick={() => { setSaveChangeToWallet(true); setChangeToWallet(''); }} className="inline-flex items-center gap-1.5 text-slate-500 underline decoration-slate-300 underline-offset-2 transition hover:text-emerald-700 hover:decoration-emerald-300">
                  <WalletCards size={14} /> ¿Guardar una parte del cambio en monedero?
                </button>
              )}
            </div>
          )}

          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          <Button className="w-full" size="lg" disabled={processing || walletPinSending} onClick={attemptSale}>
            {walletPinSending ? 'Enviando PIN...' : processing ? 'Procesando...' : 'Confirmar venta'}
          </Button>
        </div>
      </Modal>

      {/* Customer search */}
      <Modal open={customerSearchOpen && !newCustomerOpen} onClose={() => setCustomerSearchOpen(false)} title="Seleccionar cliente" size="md">
        <div className="space-y-3">
          <SearchInput value={customerSearch} onChange={setCustomerSearch} placeholder="Buscar cliente..." />
          <div className="max-h-72 space-y-1 overflow-y-auto">
            {filteredCustomers.map((c) => (
              <button
                key={c.id}
                onClick={() => { setSelectedCustomer(c); setCustomerSearchOpen(false); setSendPhone(c.phone ?? ''); setSendEmail(c.email ?? ''); }}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <div>
                  <div className="font-medium text-slate-700">{c.name}</div>
                  <div className="text-xs text-slate-400">{c.phone ?? 'Sin teléfono'}{c.codigo_cliente ? ` · ${c.codigo_cliente}` : ''}</div>
                </div>
                {Number(c.saldo_monedero) > 0 && (
                  <span className="flex-shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">{formatCurrency(c.saldo_monedero, currencySymbol)}</span>
                )}
              </button>
            ))}
            {filteredCustomers.length === 0 && (
              <p className="py-6 text-center text-sm text-slate-400">Sin resultados</p>
            )}
          </div>
          <Button className="w-full" variant="secondary" onClick={() => { setNewCustomerOpen(true); setNcError(null); }}><UserPlus size={16} /> Registrar nuevo cliente</Button>
        </div>
      </Modal>

      {/* New customer quick form */}
      <Modal open={newCustomerOpen} onClose={() => { setNewCustomerOpen(false); setCustomerSearchOpen(false); }} title="Nuevo cliente" size="md">
        <div className="space-y-3">
          <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">El sistema genera automáticamente un código único para el cliente.</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Nombre *"><Input value={ncName} onChange={(e) => setNcName(e.target.value)} placeholder="Nombre" /></Field>
            <Field label="Apellido paterno *"><Input value={ncPaterno} onChange={(e) => setNcPaterno(e.target.value)} /></Field>
          </div>
          <Field label="Apellido materno"><Input value={ncMaterno} onChange={(e) => setNcMaterno(e.target.value)} /></Field>
          <Field label="WhatsApp (10 dígitos) *">
            <PhoneDigitsInput value={ncPhone} onChange={setNcPhone} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><Field label="Calle *"><Input value={ncCalle} onChange={(e) => setNcCalle(e.target.value)} /></Field></div>
            <Field label="Número *"><Input value={ncNumero} onChange={(e) => setNcNumero(e.target.value)} /></Field>
          </div>
          <Field label="Colonia *"><Input value={ncColonia} onChange={(e) => setNcColonia(e.target.value)} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Población"><Input value={ncPoblacion} onChange={(e) => setNcPoblacion(e.target.value)} /></Field>
            <Field label="Municipio *"><Input value={ncMunicipio} onChange={(e) => setNcMunicipio(e.target.value)} /></Field>
          </div>
          {ncError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{ncError}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setNewCustomerOpen(false); setNcError(null); }}>Cancelar</Button>
            <Button onClick={saveQuickCustomer} disabled={ncSaving}>{ncSaving ? 'Guardando...' : 'Guardar y seleccionar'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!rechargeConfirmation} onClose={() => {}} title={rechargeConfirmation?.result.ok && rechargeConfirmation.reason !== '__needs_reason__' ? 'Confirmar recarga' : 'Recarga no confirmada'} size="sm">
        {rechargeConfirmation && (
          <div className="space-y-4">
            <div className={`rounded-xl p-4 ${rechargeConfirmation.result.ok ? 'bg-emerald-50' : 'bg-red-50'}`}>
              <div className="text-lg font-bold text-slate-800">{rechargeConfirmation.result.ok ? 'El proveedor mostró Recarga Exitosa' : 'El proveedor no confirmó la recarga'}</div>
              <div className="mt-2 space-y-1 text-sm text-slate-600"><div>Compañía: {pendingRecharge?.company}</div><div>Monto: {formatCurrency(Number(pendingRecharge?.amount ?? 0), currencySymbol)}</div>{rechargeConfirmation.result.providerFolio && <div>Folio de autorización: {rechargeConfirmation.result.providerFolio}</div>}</div>
            </div>
            {rechargeConfirmation.result.ok && rechargeConfirmation.reason !== '__needs_reason__' ? <><p className="text-sm text-slate-600">Confirma que la recarga se realizó correctamente para registrarla como venta.</p><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRechargeConfirmation({ result: rechargeConfirmation.result, reason: '__needs_reason__' })}>No se realizó</Button><Button onClick={() => void saveRechargeOutcome(true, rechargeConfirmation.result, '')}>Sí, registrar venta</Button></div></> : <><Field label="Causa de la recarga no realizada"><Textarea rows={3} value={rechargeConfirmation.reason === '__needs_reason__' ? '' : rechargeConfirmation.reason} onChange={(e) => setRechargeConfirmation({ result: rechargeConfirmation.result, reason: e.target.value })} placeholder="Describe qué ocurrió" /></Field><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRechargeConfirmation(null)}>Volver</Button><Button onClick={() => { const reason = rechargeConfirmation.reason.trim(); if (!reason || reason === '__needs_reason__') { setError('Escribe la causa de la recarga no realizada.'); return; } void saveRechargeOutcome(false, rechargeConfirmation.result, reason); }}>Registrar anulada</Button></div></>}
          </div>
        )}
      </Modal>

      {/* Wallet PIN verification modal */}
      <Modal open={walletPinOpen} onClose={() => { setWalletPinOpen(false); setWalletPinCode(''); setWalletVerificationId(null); setWalletPinError(null); }} title="Autorización de monedero" size="sm">
        <div className="space-y-4">
          <div className="rounded-lg bg-emerald-50 p-4 text-center">
            <Lock size={28} className="mx-auto mb-2 text-emerald-600" />
            <p className="text-sm text-slate-700">Se envió un PIN de 6 dígitos al correo del cliente:</p>
            <p className="mt-1 font-semibold text-slate-800">{selectedCustomer?.email}</p>
            <p className="mt-2 text-xs text-slate-500">Pide al cliente que revise su correo y te dé el PIN para autorizar la venta.</p>
          </div>
          <Field label="PIN de autorización">
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={walletPinCode}
              onChange={(e) => setWalletPinCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void verifyPinAndComplete(); } }}
              placeholder="000000"
              autoFocus
              className="text-center text-2xl tracking-widest"
            />
          </Field>
          {walletPinError && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{walletPinError}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setWalletPinOpen(false); setWalletPinCode(''); setWalletVerificationId(null); setWalletPinError(null); }}>Cancelar</Button>
            <Button disabled={walletPinVerifying || walletPinCode.length < 6} onClick={() => void verifyPinAndComplete()}>
              {walletPinVerifying ? 'Verificando...' : 'Autorizar venta'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Success */}
      <Modal open={!!lastSale} onClose={() => setLastSale(null)} title="Venta completada" size="sm">
        <div className="flex flex-col items-center text-center py-4">
          <CheckCircle2 size={56} className="mb-3 text-emerald-500" />
          <div className="text-sm text-slate-500">Folio</div>
          <div className="text-xl font-bold text-slate-800">{lastSale?.folio}</div>
          <div className="mt-4 w-full space-y-2 rounded-lg bg-slate-50 p-4 text-sm">
            <div className="flex justify-between"><span className="text-slate-600">Total</span><span className="font-bold">{formatCurrency(lastSale?.total ?? 0, currencySymbol)}</span></div>
            {lastSale && lastSale.change > 0 && (
              <div className="flex justify-between"><span className="text-slate-600">Cambio</span><span className="font-bold text-emerald-600">{formatCurrency(lastSale.change, currencySymbol)}</span></div>
            )}
          </div>
          {lastSale?.paymentDetails && lastSale.paymentMethod === 'tarjeta' && (
            <div className="mt-3 w-full space-y-1.5 rounded-lg border border-blue-100 bg-blue-50/60 p-4 text-left text-sm">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#0b347d]">Datos de tarjeta</div>
              <div className="flex justify-between"><span className="text-slate-600">Tipo</span><span className="font-medium text-slate-800">{lastSale.paymentDetails.card_type === 'credito' ? 'Crédito' : 'Débito'}</span></div>
              {lastSale.paymentDetails.card_last4 && <div className="flex justify-between"><span className="text-slate-600">Tarjeta</span><span className="font-medium text-slate-800">**** {String(lastSale.paymentDetails.card_last4)}</span></div>}
              {lastSale.paymentDetails.card_bank && <div className="flex justify-between"><span className="text-slate-600">Banco</span><span className="font-medium text-slate-800">{String(lastSale.paymentDetails.card_bank)}</span></div>}
              {lastSale.paymentDetails.authorization_number && <div className="flex justify-between"><span className="text-slate-600">No. de autorización</span><span className="font-medium text-slate-800">{String(lastSale.paymentDetails.authorization_number)}</span></div>}
              <div className="flex justify-between"><span className="text-slate-600">Autorizado con NIP</span><span className="font-medium text-slate-800">{lastSale.paymentDetails.nip_mode === 'con_nip' ? 'Sí' : 'No'}</span></div>
              {lastSale.paymentDetails.nip_mode === 'sin_nip' && (
                <div className="mt-2 space-y-1.5 border-t border-blue-100 pt-2">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cliente que pagó</div>
                  {lastSale.paymentDetails.customer_name && <div className="flex justify-between"><span className="text-slate-600">Nombre</span><span className="font-medium text-slate-800">{String(lastSale.paymentDetails.customer_name)}</span></div>}
                  {lastSale.paymentDetails.customer_phone && <div className="flex justify-between"><span className="text-slate-600">Teléfono</span><span className="font-medium text-slate-800">{String(lastSale.paymentDetails.customer_phone)}</span></div>}
                  {lastSale.paymentDetails.customer_address && <div className="flex justify-between gap-3"><span className="text-slate-600">Domicilio</span><span className="text-right font-medium text-slate-800">{String(lastSale.paymentDetails.customer_address)}</span></div>}
                  <div className="flex justify-between"><span className="text-slate-600">¿Firmó el ticket?</span><span className="font-medium text-slate-800">{lastSale.paymentDetails.ticket_signed ? 'Sí' : 'No'}</span></div>
                </div>
              )}
            </div>
          )}
          {lastSale?.paymentDetails && lastSale.paymentMethod === 'transferencia' && (
            <div className="mt-3 w-full space-y-1.5 rounded-lg border border-cyan-100 bg-cyan-50/60 p-4 text-left text-sm">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-cyan-800">Datos de transferencia</div>
              {lastSale.paymentDetails.receiving_bank_name && <div className="flex justify-between"><span className="text-slate-600">Cuenta receptora</span><span className="font-medium text-slate-800">{String(lastSale.paymentDetails.receiving_bank_name)}</span></div>}
              {lastSale.paymentDetails.transfer_origin_bank && <div className="flex justify-between"><span className="text-slate-600">Banco de origen</span><span className="font-medium text-slate-800">{String(lastSale.paymentDetails.transfer_origin_bank)}</span></div>}
              {lastSale.paymentDetails.transfer_origin_account && <div className="flex justify-between"><span className="text-slate-600">Cuenta de origen</span><span className="font-medium text-slate-800">{String(lastSale.paymentDetails.transfer_origin_account)}</span></div>}
              {lastSale.paymentDetails.transfer_concept && <div className="flex justify-between gap-3"><span className="text-slate-600">Concepto</span><span className="text-right font-medium text-slate-800">{String(lastSale.paymentDetails.transfer_concept)}</span></div>}
            </div>
          )}
          {lastSale?.paymentMethod === 'monedero_electronico' && (
            <div className="mt-3 w-full space-y-1.5 rounded-lg border border-emerald-100 bg-emerald-50/60 p-4 text-left text-sm">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-emerald-800">Pago con monedero</div>
              {lastSale?.wallet && <>
                <div className="flex justify-between"><span className="text-slate-600">Pagado con monedero</span><span className="font-medium text-slate-800">{formatCurrency(lastSale.wallet.redeemed, currencySymbol)}</span></div>
                <div className="flex justify-between"><span className="text-slate-600">Puntos acumulados</span><span className="font-medium text-emerald-700">{lastSale.wallet.points_earned}</span></div>
                {lastSale.wallet.change_saved > 0 && <div className="flex justify-between"><span className="text-slate-600">Cambio guardado en monedero</span><span className="font-medium text-slate-800">{formatCurrency(lastSale.wallet.change_saved, currencySymbol)}</span></div>}
                <div className="flex justify-between"><span className="text-slate-600">Saldo restante</span><span className="font-bold text-emerald-700">{formatCurrency(lastSale.wallet.balance, currencySymbol)}</span></div>
              </>}
            </div>
          )}
          {lastSale?.paymentMethod === 'mixto' && lastSale?.paymentDetails?.mixed_payments && (
            <div className="mt-3 w-full space-y-1.5 rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-left text-sm">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Pago mixto</div>
              {(() => {
                try {
                  const payments = JSON.parse(String(lastSale.paymentDetails?.mixed_payments)) as Array<{ method: string; amount: number }>;
                  return payments.map((p) => <div key={p.method} className="flex justify-between"><span className="text-slate-600">{PAYMENT_METHODS.find((m) => m.value === p.method)?.label ?? p.method}</span><span className="font-medium text-slate-800">{formatCurrency(Number(p.amount), currencySymbol)}</span></div>);
                } catch { return null; }
              })()}
              {lastSale?.wallet && lastSale.wallet.points_earned > 0 && <div className="flex justify-between border-t border-slate-200 pt-1.5"><span className="text-slate-600">Puntos acumulados</span><span className="font-medium text-emerald-700">{lastSale.wallet.points_earned}</span></div>}
            </div>
          )}
          {/* QR del ticket */}
          {qrUrl && (
            <div className="mt-4 flex w-full flex-col items-center rounded-lg border border-slate-200 bg-white p-4 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Escanea para ver tu ticket</div>
              <img src={qrUrl} alt="Código QR del ticket" className="mt-2 h-40 w-40" />
              <div className="mt-2 text-xs text-slate-400">Folio: {lastSale?.folio}</div>
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-2"><Button variant="secondary" onClick={() => setLastSale(null)}>Listo</Button><Button onClick={() => lastSale && void printTicket(lastSale)}>Imprimir ticket</Button></div>

          {/* Send options */}
          <div className="mt-5 w-full space-y-3 rounded-lg border border-slate-200 p-4 text-left">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Enviar ticket</div>
            <Field label="WhatsApp (teléfono del cliente)">
              <Input
                type="tel"
                value={sendPhone}
                onChange={(e) => setSendPhone(e.target.value)}
                placeholder="Ej: 525512345678"
              />
            </Field>
            <Button
              variant="secondary"
              className="w-full"
              disabled={!lastSale || !sendPhone.trim()}
              onClick={() => {
                if (!lastSale) return;
                const text = buildTicketText(lastSale);
                window.open(buildWhatsAppUrl(sendPhone.trim(), text), '_blank', 'noopener,noreferrer');
              }}
            >
              <MessageCircle size={16} /> Enviar por WhatsApp
            </Button>
            <Field label="Correo electrónico">
              <Input
                type="email"
                value={sendEmail}
                onChange={(e) => setSendEmail(e.target.value)}
                placeholder="cliente@correo.com"
              />
            </Field>
            <Button
              variant="secondary"
              className="w-full"
              disabled={!lastSale || !sendEmail.trim() || sending}
              onClick={async () => {
                if (!lastSale) return;
                setSending(true);
                setSendStatus(null);
                try {
                  const text = buildTicketText(lastSale);
                  const { data: sessionData } = await supabase.auth.getSession();
                  const sessionToken = sessionData?.session?.access_token;
                  if (!sessionToken) throw new Error('Sesión no válida');
                  const logoAbsoluteUrl = `${window.location.origin}${PROGRAM_LOGO}`;
                  let pdfBase64: string | undefined;
                  try {
                    pdfBase64 = await generateTicketPdfBase64(lastSale);
                  } catch (pdfErr) {
                    console.error('PDF generation failed', pdfErr);
                  }
                  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-ticket-email`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sessionToken}` },
                    body: JSON.stringify({ to: sendEmail.trim(), subject: `Ticket ${lastSale.folio}`, text, folio: lastSale.folio, storeName: lastSale.storeName, pdfBase64, logoUrl: logoAbsoluteUrl }),
                  });
                  if (!res.ok) {
                    const errBody = await res.json().catch(() => ({}));
                    throw new Error(errBody.error ?? 'No se pudo enviar');
                  }
                  setSendStatus('Correo enviado correctamente');
                } catch {
                  setSendStatus('No se pudo enviar el correo. Verifica la configuración.');
                } finally {
                  setSending(false);
                }
              }}
            >
              {sending ? 'Enviando...' : <><Mail size={16} /> Enviar por correo</>}
            </Button>
            {sendStatus && <div className={`rounded-lg px-3 py-2 text-sm ${sendStatus.includes('correctamente') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{sendStatus}</div>}
          </div>
        </div>
      </Modal>

      {loading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80">
          <Spinner size={32} />
        </div>
      )}

      {subMenu.modals}

      <BarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetect={(code) => { setSearch(code); handleScan(code); }}
        title="Escanear producto"
      />
      </div>
    </div>
  );
}

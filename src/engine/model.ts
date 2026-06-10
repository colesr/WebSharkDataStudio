// ---------------------------------------------------------------------------
// Model training/evaluation — runs scikit-learn inside Pyodide.
//
// This module is pure: it only holds the Python script and the result type.
// engine/python.ts owns the runtime and injects the config + input table.
//
// Sandbox tie-in (on-brand): every model is judged against a dumb BASELINE
// (a "model contract" — it must beat predicting the mean/majority), screened
// for obvious LEAKAGE, and STRESS-TESTED by perturbing the held-out test set
// to see how stable the metric is.
// ---------------------------------------------------------------------------

export interface ModelResult {
  task: 'classification' | 'regression'
  algo: string
  features: string[]
  nTrain: number
  nTest: number
  nFeatures: number
  metrics: Record<string, number>
  baseline: Record<string, number>
  primaryMetric: { name: string; model: number; baseline: number }
  beatsBaseline: boolean
  confusion?: { labels: string[]; matrix: number[][] }
  importances?: { feature: string; value: number }[]
  leakage: { feature: string; reason: string }[]
  stress: { name: string; metric: number | null; clean: number }[]
  warnings: string[]
  error?: string
}

// The script expects two globals injected by python.ts:
//   _model_cfg  → { table, target, algo, features, seed }
//   _ws_inputs  → Map with the input table's CSV (so ws.table works)
// and leaves the result in `_result` (a JSON-serializable dict).
export const MODEL_SCRIPT = `
import numpy as np, pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression, LinearRegression
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn import metrics as M

cfg = _model_cfg
seed = int(cfg.get('seed', 42))
table = cfg['table']
target = cfg['target']
algo = cfg.get('algo', 'forest')
features = list(cfg.get('features') or [])

res = {'algo': algo, 'features': features, 'leakage': [], 'stress': [], 'warnings': []}

df = ws.table(table)
if target not in df.columns:
    raise ValueError('Target column not found: ' + str(target))

df = df[df[target].notna()].copy()
if len(df) < 10:
    raise ValueError('Need at least 10 non-null target rows to train.')

if features:
    features = [f for f in features if f in df.columns and f != target]
else:
    features = [c for c in df.columns if c != target]
if not features:
    raise ValueError('No feature columns selected.')
res['features'] = features

y = df[target]
y_nunique = int(y.nunique(dropna=True))
is_num_target = pd.api.types.is_numeric_dtype(y)
class_cap = max(2, min(20, int(len(y) * 0.05)))
task = 'regression' if (is_num_target and y_nunique > class_cap) else 'classification'
res['task'] = task

# --- leakage screen (on raw features) ---
for f in features:
    s = df[f]
    if f.lower() == target.lower():
        res['leakage'].append({'feature': f, 'reason': 'same as target'}); continue
    if s.nunique(dropna=True) <= 1:
        res['leakage'].append({'feature': f, 'reason': 'constant (no signal)'})
    if is_num_target and pd.api.types.is_numeric_dtype(s):
        try:
            c = float(np.corrcoef(s.fillna(s.median()), y.astype(float))[0, 1])
            if abs(c) > 0.98:
                res['leakage'].append({'feature': f, 'reason': 'corr ' + format(c, '.3f') + ' with target'})
        except Exception:
            pass
    if len(s) > 20 and s.nunique(dropna=True) >= 0.95 * len(s):
        res['leakage'].append({'feature': f, 'reason': 'near-unique (id-like)'})

# --- encode features ---
X = df[features].copy()
num_cols = X.select_dtypes(include=[np.number]).columns.tolist()
cat_cols = [c for c in X.columns if c not in num_cols]
for c in num_cols:
    X[c] = X[c].fillna(X[c].median())
for c in cat_cols:
    X[c] = X[c].astype(str).fillna('NA')
if cat_cols:
    X = pd.get_dummies(X, columns=cat_cols)
X = X.astype(float).fillna(0.0)

y_enc = y.astype(str) if task == 'classification' else pd.to_numeric(y, errors='coerce').astype(float)

strat = None
if task == 'classification' and y_enc.nunique() > 1 and y_enc.value_counts().min() >= 2:
    strat = y_enc
Xtr, Xte, ytr, yte = train_test_split(X, y_enc, test_size=0.25, random_state=seed, stratify=strat)
res['nTrain'] = int(len(Xtr)); res['nTest'] = int(len(Xte)); res['nFeatures'] = int(X.shape[1])

def make_model():
    if task == 'classification':
        if algo == 'linear': return LogisticRegression(max_iter=1000)
        if algo == 'tree': return DecisionTreeClassifier(random_state=seed)
        return RandomForestClassifier(n_estimators=120, random_state=seed)
    if algo == 'linear': return LinearRegression()
    if algo == 'tree': return DecisionTreeRegressor(random_state=seed)
    return RandomForestRegressor(n_estimators=120, random_state=seed)

model = make_model()
model.fit(Xtr, ytr)
pred = model.predict(Xte)

if task == 'classification':
    base = DummyClassifier(strategy='most_frequent').fit(Xtr, ytr)
    bpred = base.predict(Xte)
    res['metrics'] = {
        'accuracy': float(M.accuracy_score(yte, pred)),
        'f1': float(M.f1_score(yte, pred, average='weighted', zero_division=0)),
        'precision': float(M.precision_score(yte, pred, average='weighted', zero_division=0)),
        'recall': float(M.recall_score(yte, pred, average='weighted', zero_division=0)),
    }
    res['baseline'] = {'accuracy': float(M.accuracy_score(yte, bpred))}
    labels = sorted([str(l) for l in pd.unique(y_enc)])
    cm = M.confusion_matrix(yte.astype(str), pd.Series(pred).astype(str), labels=labels)
    res['confusion'] = {'labels': labels, 'matrix': cm.astype(int).tolist()}
    res['primaryMetric'] = {'name': 'accuracy', 'model': res['metrics']['accuracy'], 'baseline': res['baseline']['accuracy']}
    res['beatsBaseline'] = res['metrics']['accuracy'] > res['baseline']['accuracy'] + 1e-9
    def primary(yt, pr): return float(M.accuracy_score(yt.astype(str), pd.Series(pr, index=yt.index).astype(str)))
else:
    base = DummyRegressor(strategy='mean').fit(Xtr, ytr)
    bpred = base.predict(Xte)
    res['metrics'] = {
        'r2': float(M.r2_score(yte, pred)),
        'mae': float(M.mean_absolute_error(yte, pred)),
        'rmse': float(np.sqrt(M.mean_squared_error(yte, pred))),
    }
    res['baseline'] = {'r2': float(M.r2_score(yte, bpred)), 'mae': float(M.mean_absolute_error(yte, bpred))}
    res['primaryMetric'] = {'name': 'R2', 'model': res['metrics']['r2'], 'baseline': res['baseline']['r2']}
    res['beatsBaseline'] = res['metrics']['r2'] > res['baseline']['r2'] + 1e-9
    def primary(yt, pr): return float(M.r2_score(yt, pr))

# --- feature importances ---
try:
    if hasattr(model, 'feature_importances_'):
        pairs = sorted(zip(X.columns, model.feature_importances_), key=lambda t: -t[1])[:8]
        res['importances'] = [{'feature': str(f), 'value': float(v)} for f, v in pairs]
    elif hasattr(model, 'coef_'):
        coef = np.ravel(model.coef_)
        pairs = sorted(zip(X.columns, np.abs(coef)), key=lambda t: -t[1])[:8]
        res['importances'] = [{'feature': str(f), 'value': float(v)} for f, v in pairs]
except Exception:
    pass

# --- model stress-test: perturb the held-out test set ---
clean = primary(yte, pred)
rng = np.random.default_rng(seed)

def metric_after(Xp):
    try:
        return float(primary(yte, model.predict(Xp)))
    except Exception:
        return None

Xn = Xte.copy()
for c in Xn.columns:
    col = Xn[c].astype(float)
    sd = col.std()
    Xn[c] = col + rng.normal(0, (sd if sd and sd > 0 else 1.0) * 0.1, size=len(col))
res['stress'].append({'name': '+10% gaussian noise', 'metric': metric_after(Xn), 'clean': clean})

Xz = Xte.copy().astype(float)
mask = rng.random(Xz.shape) < 0.10
Xz = Xz.mask(mask, 0.0)
res['stress'].append({'name': '10% values zeroed', 'metric': metric_after(Xz), 'clean': clean})

try:
    imps = res.get('importances') or []
    topf = imps[0]['feature'] if imps else None
    if topf and topf in Xte.columns:
        Xs = Xte.copy()
        Xs[topf] = rng.permutation(Xs[topf].values)
        res['stress'].append({'name': 'shuffle "' + str(topf) + '"', 'metric': metric_after(Xs), 'clean': clean})
except Exception:
    pass

_result = res
`

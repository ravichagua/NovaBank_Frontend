import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import Pantalla from '../../componentes/Pantalla';
import FilaTransaccion from '../../componentes/FilaTransaccion';
import Icono from '../../componentes/Icono';
import SelectorIdioma from '../../componentes/SelectorIdioma';
import { usarTema } from '../../tema/ContextoTema';
import { fuentes } from '../../tema/estilos';
import { dinero } from '../../libreria/formato';
import { usarEstadoApp } from '../../estado/ContextoEstadoApp';
import { ListaParametrosPestanas } from '../../navegacion/tipos';
import { usarIdioma } from '../../i18n/ContextoIdioma';

type Navegacion = BottomTabNavigationProp<ListaParametrosPestanas>;

export default function PantallaInicio() {
  const nav = useNavigation<Navegacion>();
  const { tema, oscuro, alternar } = usarTema();
  const { t } = usarIdioma();
  const { usuario, disponible, retenido, lineaCredito, pagoMinimo, fechaCorte, tarjetaBloqueada, transacciones } = usarEstadoApp();

  const [ocultar, setOcultar] = useState(false);

  const recientes = transacciones.slice(0, 4);
  const enmascarar = (v: string) => v.replace(/[0-9]/g, '•');

  return (
    <Pantalla scroll padded={false} bg={tema.fondo}>
      <LinearGradient colors={['#0E2C4E', '#061626']} start={{ x: 0.85, y: 0 }} end={{ x: 0.2, y: 1 }} style={{ paddingTop: 14, paddingHorizontal: 22, paddingBottom: 30, borderBottomLeftRadius: 34, borderBottomRightRadius: 34 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: 'rgba(255,255,255,.12)', borderWidth: 1, borderColor: 'rgba(217,190,122,.4)', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontFamily: fuentes.headingBold, fontSize: 14, color: '#E7CE92' }}>{usuario.iniciales}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fuentes.body, fontSize: 11, color: 'rgba(217,190,122,.85)', letterSpacing: 1.4, textTransform: 'uppercase' }}>{t('home.privateBanking')}</Text>
            <Text style={{ marginTop: 3, fontFamily: fuentes.headingBold, fontSize: 16, color: '#fff' }}>{usuario.name}</Text>
          </View>
          <SelectorIdioma oscuro compacto />
          <Pressable onPress={alternar} style={estilosH.iconBtn}>
            <Icono name={oscuro ? 'light_mode' : 'dark_mode'} size={19} color="#E7CE92" />
          </Pressable>
        </View>

        <View style={{ marginTop: 24, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Text style={{ fontFamily: fuentes.body, fontSize: 12.5, color: 'rgba(255,255,255,.6)' }}>{t('home.availableBalance')}</Text>
          <Pressable onPress={() => setOcultar((h) => !h)} style={estilosH.eyeBtn}>
            <Icono name={ocultar ? 'visibility_off' : 'visibility'} size={17} color="#fff" />
          </Pressable>
        </View>
        <Text style={{ marginTop: 6, fontFamily: fuentes.heading, fontSize: 42, letterSpacing: -1.8, color: '#fff' }}>
          {ocultar ? enmascarar(dinero(disponible)) : dinero(disponible)}
        </Text>
        <View style={{ marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#21A26B' }} />
          <Text style={{ fontFamily: fuentes.body, fontSize: 12, color: 'rgba(255,255,255,.7)' }}>
            {usuario.accountNumber} · {t('home.savingsAccount')}
          </Text>
        </View>

        <View style={{ marginTop: 24, paddingTop: 18, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.1)', flexDirection: 'row', flexWrap: 'wrap' }}>
          <MiniEstadistica label={t('home.heldBalance')} value={ocultar ? '••••' : dinero(retenido)} />
          <MiniEstadistica label={t('home.creditLine')} value={ocultar ? '••••' : dinero(lineaCredito)} />
          <MiniEstadistica label={t('home.minPayment')} value={ocultar ? '••••' : dinero(pagoMinimo)} />
          <MiniEstadistica label={t('home.cutDate')} value={fechaCorte || '28 oct'} />
        </View>
      </LinearGradient>

      <View style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 30 }}>
        {/* Acceso directo a tarjeta */}
        <Pressable
          onPress={() => nav.navigate('Card')}
          style={{ borderRadius: 20, padding: 18, backgroundColor: tarjetaBloqueada ? '#5B6875' : '#123A63', flexDirection: 'row', alignItems: 'center', gap: 14 }}
        >
          <Icono name={tarjetaBloqueada ? 'lock' : 'credit_card'} size={26} color="#fff" />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: fuentes.headingBold, fontSize: 14.5, color: '#fff' }}>NovaBank Visa ···{usuario.cardNumber.slice(-4)}</Text>
            <Text style={{ marginTop: 3, fontFamily: fuentes.body, fontSize: 11.5, color: 'rgba(255,255,255,.65)' }}>
              {t('home.cardStatus', { status: tarjetaBloqueada ? t('home.cardBlocked') : t('home.cardActive') })}
            </Text>
          </View>
          <Icono name="chevron_right" size={20} color="rgba(255,255,255,.7)" />
        </Pressable>

        {/* Movimientos recientes */}
        <View style={{ marginTop: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ fontFamily: fuentes.headingBold, fontSize: 15.5, color: tema.tinta }}>{t('home.recentMovements')}</Text>
        </View>
        <View style={{ marginTop: 8, borderRadius: 20, backgroundColor: tema.superficie, borderWidth: 1, borderColor: tema.linea, overflow: 'hidden' }}>
          {recientes.length === 0 ? (
            <View style={{ padding: 24, alignItems: 'center' }}>
              <Text style={{ fontFamily: fuentes.body, fontSize: 13, color: tema.suave }}>Sin movimientos recientes</Text>
            </View>
          ) : (
            recientes.map((transaccion) => (
              <FilaTransaccion key={transaccion.id} tx={transaccion} mostrarFecha />
            ))
          )}
        </View>
      </View>
    </Pantalla>
  );
}

function MiniEstadistica({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ width: '50%', marginBottom: 10 }}>
      <Text style={{ fontFamily: fuentes.body, fontSize: 11, color: 'rgba(255,255,255,.55)' }}>{label}</Text>
      <Text style={{ marginTop: 4, fontFamily: fuentes.headingBold, fontSize: 15, color: '#fff' }}>{value}</Text>
    </View>
  );
}

const estilosH = {
  iconBtn: { width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(255,255,255,.12)', alignItems: 'center' as const, justifyContent: 'center' as const },
  eyeBtn: { width: 28, height: 28, borderRadius: 9, backgroundColor: 'rgba(255,255,255,.14)', alignItems: 'center' as const, justifyContent: 'center' as const },
};

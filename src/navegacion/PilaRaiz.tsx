import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ListaParametrosRaiz } from './tipos';
import PestanasApp from './PestanasApp';

const Stack = createNativeStackNavigator<ListaParametrosRaiz>();

export default function PilaRaiz() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Main" component={PestanasApp} />
    </Stack.Navigator>
  );
}
